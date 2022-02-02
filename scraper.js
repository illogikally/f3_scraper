const {Builder, By, Key, until} = require('selenium-webdriver');
const util = require('util');
const fs = require('fs').promises;
const fsd = require('fs');
const spotifyApi = require('spotify-web-api-node');
const id3 = require('node-id3').Promise;
const axios = require('axios').default;
const path = require('path');
const process = require('process');
let chrome = require('selenium-webdriver/chrome');

const spotify = new spotifyApi({
  clientId: '1fdb514647fe4126861eb8ff36f9197f',
  clientSecret: '6191c4d5bee14875ae1463b843b276e5'
});

let currentSong = '';
let downloadState = '';
let completed = 0;
let totalSongs;
(async () => {
  await spotifySetup();
  let playlistId = process.argv[2];
  const startSongIndex = process.argv[3] || -1;
  let playlist = await spotify.getPlaylistTracks(playlistId);
  let tracks = playlist.body.items.filter((_,i) => i >= startSongIndex).map(track => {
    track = track.track;
    return {
      name: track.name,
      albumName: track.album.name,
      albumCoverUrl: track.album.images[0].url,
      artists: track.artists.map(a => a.name),
      trackNumber: track.track_number,
      downloadedFileName: ''
    }
  });
  totalSongs = tracks.length;

  const options = new chrome.Options()
      .addExtensions("ublock-origin.crx")
      .addArguments('--window-size=600,800', 'window-position=1200,100', '--log-level=3')
      .addArguments('excludeSwitches', ['enable-logging'])
      .setUserPreferences({"download.default_directory": path.join(__dirname, 'download')});
  const driver = await new Builder()
      .forBrowser('chrome')
      .setChromeOptions(options)
      .build();

  let skipped = [];
  let lastFilePath = ''
  try {
    await driver.get('https://free-mp3-download.net/');
    spinner();
    for (const track of tracks) {
      downloadState = 'FINDING';
      currentSong = track.name;
      let searchKeyword = `${track.artists[0]} - ${track.name}`;
      await driver.wait(until.elementLocated(By.id('q')));
      let q = await driver.findElement(By.id('q'));
      await q.clear();
      await q.sendKeys(searchKeyword, Key.RETURN);
      await wait(By.id("results_t"));
      let results = await driver.findElement(By.id("results_t"));
      let resultLength = (await results.findElements(By.css('tr'))).length;
      let found = false;
      for (let i = 0; i < resultLength; ++i) {
        await driver.wait(until.elementsLocated(By.id("results_t")), 5e3);
        let results = await driver.findElement(By.id("results_t"));
        let result = results.findElement(By.xpath(`tr[${i+1}]`));
        let title = await (await result.findElement(By.xpath('td[1]'))).getText()
        if (!title.toLocaleLowerCase().includes(searchKeyword.toLocaleLowerCase())) {
          continue;
        }
        track.downloadedFileName = title.replace(/'/g, '-\'').replace(/[<>:"|?*]/g, '').replace(/[\/]/g, '-');
        let download = await result.findElement(By.css("a"));
        await download.click();
        await wait(By.id("flac"));
        let flacRadio = await driver.findElement(By.id("flac"));
        if (!await flacRadio.isEnabled()) {
          await (await driver.findElement(By.xpath('\/\/a[text() = "Back to search"]'))).click();
          await driver.wait(until.elementLocated(By.id('results_t')));
          continue;
        } 
        await (await driver.findElement(By.css('label[for="flac"]'))).click();
        found = true;
        break;
      }

      if (!found) {
        skipped.push(track);
        continue;
      }

      await driver.executeScript('window.scrollTo(0, document.body.scrollHeight);');
      try {
        await wait(By.css('iframe[title="reCAPTCHA"]'), 500);
        downloadState = 'CAPTCHA';
        let iframe = await driver.findElement(By.css('iframe[title="reCAPTCHA"]'));
        await driver.switchTo().frame(iframe);
        let box = await driver.findElement(By.css('.recaptcha-checkbox-border[role="presentation"]'));
        await box.click();
        await driver.wait(isCaptchaChecked(driver));
        await driver.switchTo().defaultContent();
      } catch {}

      await wait(By.className('dl'));
      await click(By.className('dl'));
      const filePath = path.join('.', 'download', `${track.downloadedFileName}`);
      downloadState = 'STARTING DOWNLOAD';
      await driver.wait(exists(`${filePath}.flac.crdownload`));
      downloadState = 'DOWNLOADING';
      driver.wait(exists(`${filePath}.flac`)).then(() => completed++);
      lastFilePath = `${filePath}.flac`;
      await click(By.xpath('\/\/a[text() = "Back to search"]'));
      await wait(By.id('results_t'));
      // populateId3Tags(track);
    }
  } finally {
    // await driver.wait(exists(lastFilePath));
    while (completed + skipped.length < totalSongs) {
      await sleep(.5);
    }
    downloadState = 'DONE';
    if (skipped.length) {
      console.log();
      console.log('SKIPPED:', skipped);
    }
    driver.close()
  }

  async function wait(by, time=0, msg='') {
    if (time != 0) {
      await driver.wait(until.elementLocated(by), time, msg);
      return;
    }
    await driver.wait(until.elementLocated(by));
    return;
  }

  async function click(by) {
    let e = await driver.findElement(by);
    await e.click();
    return;
  }
})();

async function populateId3Tags(track) {
  let filePath = path.join(__dirname, 'download',  track.downloadedFileName + '.flac')
  console.log(filePath);
  while (true) {
    if (await exists(filePath)()) {
      break;
    }
    await sleep(.5);
  }
  let coverJpgPath = path.join(__dirname, 'download', track.albumName + '.jpg');
  let tags = {
    title: track.name,
    artist: track.artists.join(','),
    album: track.albumName,
    APIC: coverJpgPath,
    TRCK: track.trackNumber
  }
  if (!await exists(coverJpgPath)()) {
    axios.get(track.albumCoverUrl, {responseType: 'stream'})
    .then(response => {
      response.data.pipe(fsd.createWriteStream(coverJpgPath));
      id3.update(tags, filePath);
    });
  } else {
    id3.update(tags, filePath);
  }
}

async function spotifySetup() {
  let tokens = (await fs.readFile('tokens')).toString().split('\n');
  let [refresh, access, expire] = tokens;
  if (expire - Date.now() < 15e3) {
    spotify.setRefreshToken(refresh);
    let refreshRes = await spotify.refreshAccessToken();
    access = refreshRes.body.access_token;
    expire = refreshRes.body.expires_in*1e3 + Date.now();
    if (refresh && access && expire) {
      fs.writeFile('tokens', `${refresh}\n${access}\n${expire}`);
    }
  }
  spotify.setAccessToken(access);
}

async function sleep(seconds) {
  return new Promise(r => setTimeout(r, seconds*1000));
}

function exists(path) {
  return async () =>  {
    try {
      await fs.access(path);
      return true;
    } catch {
      return false;
    }
  }
}

async function spinner() {
  const SPINNER_CHARS = '⣾⣽⣻⢿⡿⣟⣯⣷';
  const PROGRESS_LENGTH = 30;
  const SONG_LENGTH = 25;

  let spinner, state, downloadProgress, repeat, output, downloadingSong, progress;
  for (let i = 0; downloadState != 'DONE'; ++i) {
    spinner = SPINNER_CHARS[i%SPINNER_CHARS.length];
    state = `[${downloadState}]`;
    progress = Math.floor(completed*1.0/totalSongs * PROGRESS_LENGTH);
    progressBar = `[${'#'.repeat(progress)}${' '.repeat(PROGRESS_LENGTH - progress)}]`;
    downloadProgress = `[${completed}/${totalSongs}]`;
    let songName = 
        currentSong.length <= SONG_LENGTH
        ? currentSong + ' '.repeat(SONG_LENGTH - currentSong.length)
        : currentSong.slice(0, SONG_LENGTH-3) + '...';
    downloadingSong = ` [${songName}]`;
    output = spinner + downloadingSong + progressBar + downloadProgress;
    process.stdout.write(`\r${output}`);
    await sleep(.1);
  }
}

function isCaptchaChecked(driver) {
  return async () => {
    let s = `
        return document.querySelector(
        '.recaptcha-checkbox-checkmark[role="presentation"]'
        ).hasAttribute('style')`;
    return await driver.executeScript(s);
  }
}
