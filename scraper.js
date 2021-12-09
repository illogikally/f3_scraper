const {Builder, By, Key, until} = require('selenium-webdriver');
const fs = require('fs').promises;
const path = require('path')

let chrome = require('selenium-webdriver/chrome');

sleep = async (seconds) => new Promise(r => setTimeout(r, seconds*1000));

exists = async (path) => {
  try {
    await fs.access(path);
    return true;
  }
  catch {
    return false;
  }
}

(async () => {
  let options = new chrome.Options()
      .addExtensions("ublock-origin.crx")
      .addArguments('--start-maximized')
      .setUserPreferences({"download.default_directory": `${__dirname}/download`});
  let driver = await new Builder()
      .forBrowser('chrome')
      .setChromeOptions(options)
      .build();
  try {
    await driver.get('https://recaptcha-demo.appspot.com/recaptcha-v3-request-scores.php');
    return;
    await driver.get('https://free-mp3-download.net/');
    await sleep(3);
    await driver.findElement(By.id('q')).sendKeys('dynasties', Key.RETURN);
    await driver.wait(until.elementsLocated(By.css(".bordered.highlight")), 5000);
    let results = await driver.findElements(By.css("#results_t > tr"));
    let download = await results[0].findElement(By.css("a"));
    await sleep(3.2);
    download.click();
    await driver.wait(until.elementsLocated(By.id("flac")), 5000);
    await sleep(3.3);
    await driver.findElement(By.css("label[for='flac']")).click();
    await sleep(2);
    let captcha = await driver.findElement(By.id("captcha"));
    let actions = driver.actions({async: true});
    await actions.move({origin: captcha, x: -120}).click().perform();
    await sleep(4);
    await driver.findElement(By.className("dl")).click();
    await sleep(20);
    console.log(exists(path.join(__dirname, 'download', 'Denzel Curry - Dynasties and Dystopia (from the series Arcane League of Legends).flac')))
  } finally {
    // driver.close();
  }
})();