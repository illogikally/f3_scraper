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

(async () => {
  await spotifySetup();
  let playlistId = process.argv[2];
  let playlist = await spotify.getPlaylistTracks(playlistId);
  let tracks = playlist.body.items.map(track => {
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

  const options = new chrome.Options()
      .addExtensions("ublock-origin.crx")
      .addArguments('--window-size=600,900', 'window-position=1200,200')
      .setUserPreferences({"download.default_directory": `${__dirname}\\download`});
  const driver = await new Builder()
      .forBrowser('chrome')
      .setChromeOptions(options)
      .build();

  let skipped = [];
  let lastFilePath = ''
  try {
    await driver.get('https://free-mp3-download.net/');
    for (const track of tracks) {
      let searchKeyword = `${track.artists[0]} - ${track.name}`;
      console.log(searchKeyword);
      await driver.wait(until.elementLocated(By.id('q')));
      let q = await driver.findElement(By.id('q'));
      await q.clear();
      await q.sendKeys(searchKeyword, Key.RETURN);
      await wait(By.id("results_t"));
      let results = await driver.findElement(By.id("results_t"));
      let resultLength = (await results.findElements(By.css('tr'))).length;
      let found = false;
      for (let i = 0; i < resultLength; ++i) {
        await driver.wait(until.elementsLocated(By.id("results_t")), 5000);
        let results = await driver.findElement(By.id("results_t"));
        let result = results.findElement(By.xpath(`tr[${i+1}]`));
        let title = await (await result.findElement(By.xpath('td[1]'))).getText()
        if (!title.toLocaleLowerCase().includes(searchKeyword.toLocaleLowerCase())) {
          continue;
        }
        track.downloadedFileName = title.replace('\'', '-\'')
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
        let iframe = await driver.findElement(By.css('iframe[title="reCAPTCHA"]'));
        await driver.switchTo().frame(iframe);
        let box = await driver.findElement(By.css('.recaptcha-checkbox-border[role="presentation"]'));
        await box.click();
        await driver.wait(isCaptchaChecked(driver));
        await driver.switchTo().defaultContent();
      } catch {}

      await wait(By.className('dl'));
      await click(By.className('dl'));
      await driver.wait(exists( `./download/${track.downloadedFileName}.flac.crdownload`));
      lastFilePath = `./download/${track.downloadedFileName}.flac`;
      await click(By.xpath('\/\/a[text() = "Back to search"]'));
      await wait(By.id('results_t'));
      populateId3Tags(track);
    }
  } finally {
    console.log(skipped || '');
    await driver.wait(exists(lastFilePath));
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
  if (expire - new Date().getTime() < 15000) {
    spotify.setRefreshToken(refresh);
    let refreshRes = await spotify.refreshAccessToken();
    access = refreshRes.body.access_token;
    expire = refreshRes.body.expires_in*1000 + new Date().getTime();
  }
  spotify.setAccessToken(access);
  fs.writeFile('tokens', `${refresh}\n${access}\n${expire}`);
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

function isCaptchaChecked(driver) {
  return async () => {
    let s = `
        return document.querySelector(
        '.recaptcha-checkbox-checkmark[role="presentation"]'
        ).hasAttribute('style')`;
    return await driver.executeScript(s);
  }
}
