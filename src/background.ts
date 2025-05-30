'use strict';

import { loadImageData } from "./helpers";
import LocalAlarm from "./LocalAlarm";

// this handles grey-out of icons on unsupported sites
chrome.runtime.onInstalled.addListener(() => {
  chrome.declarativeContent.onPageChanged.removeRules(async () => {
    chrome.declarativeContent.onPageChanged.addRules([
      {
        conditions: [
          new chrome.declarativeContent.PageStateMatcher({
            pageUrl: { urlMatches: 'https://.*\.youtube\.com' },
          })
        ],
        actions: [
          new chrome.declarativeContent.SetIcon({
            imageData: {
              16: await loadImageData("images/clock_16.png"),
              32: await loadImageData("images/clock_32.png"),
              48: await loadImageData("images/clock_48.png"),
              128: await loadImageData("images/clock_128.png")
            }
          }),
          chrome.declarativeContent.ShowAction
            ? new chrome.declarativeContent.ShowAction()
            : new chrome.declarativeContent.ShowPageAction()
        ]
      }
    ]);
  });
});


// cannot use async/await here since the message port listening for the response will timeout
chrome.runtime.onMessage.addListener(function (request, sender, sendResponse) {
  chrome.tabs.query({ active: true, currentWindow: true }, async function (tabs) {
    const tabId = tabs[0].id;
    if (!tabId) throw new Error(`This tab does not have a tab id, unable to run the extension on tabs without an id`);
    switch (request.msg) {
      case "startTimer":
        console.log(`start alarm for tab ${tabId}`)
        const newAlarm = new LocalAlarm(tabId, request.initTime);
        chrome.alarms.create(newAlarm.alarmName, { when: Date.now() + newAlarm.duration });
        await storeNewLocalAlarm(newAlarm);
        sendResponse();
        break;
      case "getTimer":
        const locallySavedAlarm = await findLocalAlarmByTabId(tabId)
        if (!locallySavedAlarm) { sendResponse(); break; }
        chrome.alarms.get(locallySavedAlarm.alarmName, (alarm) => {
          if (alarm)
            sendResponse({ alarm, savedAlarmDuration: locallySavedAlarm.duration });
          else
            sendResponse();
        });
        break;
      case "cancelTimer":
        console.log(`cancel alarm for tab ${tabId}`)
        deleteAlarm(tabId);
        sendResponse();
        break;
      default:
        console.log('invalid msg');
        sendResponse();
    }
  });
  return true;
});

// https://developer.chrome.com/docs/extensions/reference/alarms/#method-create
// There's a 1 minute delay for alarms api
chrome.alarms.onAlarm.addListener(async (alarm) => {
  const localAlarm = await findLocalAlarmByName(alarm.name);
  if (!localAlarm) throw new Error(`Could not find alarm called ${alarm.name}`);
  await chrome.scripting.executeScript({
    target: { tabId: localAlarm.tabId },
    func: togglePlaybackState
  });
  deleteLocalAlarm(localAlarm.tabId);
});

chrome.tabs.onRemoved.addListener((tabId) => {
  console.log(`tab ${tabId} was removed, delete it's corresponding alarm`)
  deleteAlarm(tabId);
});

chrome.tabs.onReplaced.addListener((addedTabId, removedTabId) => {
  modifyTabId(addedTabId, removedTabId);
});

const togglePlaybackState = () => {
  const hostname = window.location.hostname;
  let button: HTMLButtonElement | null = null;

  if (hostname.includes('youtube.com')) {
    // youtube music
    button = <HTMLButtonElement>document.getElementsByClassName('play-pause-button')[0];
    if (!button) {
      // youtube
      button = <HTMLButtonElement>document.getElementsByClassName('ytp-play-button')[0];
    }
  } else if (hostname.includes('bilibili.com')) {
    // bilibili
    button = <HTMLButtonElement>document.querySelector('.bpx-player-ctrl-btn.bpx-player-ctrl-play');
  }

  if (button) {
    button.click();
  } else {
    console.log('Could not find play/pause button on this page.');
  }
}

async function storeNewLocalAlarm(newAlarm: LocalAlarm) {
  const alarms = await fetchAllLocalAlarms();
  const idx = alarms.findIndex(x => x.tabId === newAlarm.tabId);

  if (idx === -1)   // store alarm if it doesn't conflict
    alarms.push(newAlarm);
  else              // otherwise, override pre-existing alarm
    alarms.splice(idx, 1, newAlarm);
  await chrome.storage.local.set({ alarms });
}

async function fetchAllLocalAlarms(): Promise<LocalAlarm[]> {
  const result = await chrome.storage.local.get('alarms');
  console.log(result)
  return result['alarms'] || [];
}

async function findLocalAlarmByTabId(tabId: number): Promise<LocalAlarm | undefined> {
  const alarms = await fetchAllLocalAlarms();
  return alarms.find(x => x.tabId === tabId);
}

async function findLocalAlarmByName(alarmName: string): Promise<LocalAlarm | undefined> {
  console.log(`looking for local alarm called ${alarmName}`)
  const alarms = await fetchAllLocalAlarms();
  return alarms.find(x => x.alarmName === alarmName);
}

async function deleteAlarm(tabId: number) {
  const deletedAlarm = await deleteLocalAlarm(tabId);
  if (deletedAlarm) {
    await chrome.alarms.clear(deletedAlarm.alarmName);
    console.log(`deleted alarm for tab id: ${tabId}`)
  }
}

async function deleteLocalAlarm(tabId: number): Promise<LocalAlarm | undefined> {
  const alarms = await fetchAllLocalAlarms();
  const idx = alarms.findIndex(x => x.tabId === tabId);
  if (idx === -1) return;
  const [alarm] = alarms.splice(idx, 1);
  await chrome.storage.local.set({ 'alarms': alarms });
  console.log(`local alarm ${alarm.alarmName} for tab ${alarm.tabId} was deleted`)
  return alarm;
}

async function modifyTabId(newTabId: number, oldTabId: number) {
  const alarms = await fetchAllLocalAlarms();
  const localAlarm = alarms.find(x => x.tabId === oldTabId);
  if (localAlarm) {
    localAlarm.tabId = newTabId;
    await chrome.storage.local.set({ 'alarms': alarms });
  }
  console.log(`tab id ${oldTabId} was changed to ${newTabId}`)
}