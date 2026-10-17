/* global window, fetch, createImageBitmap, document */
import assert from 'node:assert/strict';
import { chromium, firefox } from 'playwright';

const url = process.env.DROPPIE_URL || 'http://127.0.0.1:5180';
const useFirefox = process.env.DROPPIE_BROWSER === 'firefox';
const engine = useFirefox ? 'firefox' : 'chromium';
const browser = useFirefox ? await firefox.launch({headless: true, firefoxUserPrefs: {'dom.webgpu.enabled': true}}) : await chromium.launch({
  executablePath: '/usr/bin/google-chrome', headless: true,
  args: ['--no-sandbox', '--enable-unsafe-webgpu', '--use-angle=swiftshader', '--enable-features=Vulkan'],
});
const errors = [];
const consoleJobs = [];
const watch = page => {
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => {
    if (message.type() === 'error') consoleJobs.push(Promise.all(message.args().map(arg =>
      arg.evaluate(value => typeof value === 'object' ? value?.message || String(value) : String(value)).catch(() => message.text())
    )).then(values => errors.push(`${message.location().url}: ${values.join(' ')}`)));
  });
};
const state = page => page.evaluate(() => window.dropletDebug);
const ready = async page => {
  watch(page);
  await page.goto(url);
  await page.locator('#loading.hidden').waitFor({timeout: 60000});
  await page.locator('#loading').evaluate(element => {element.style.transition = 'none';});
  assert((await state(page)).finite, 'finite body at startup');
};
const floorBrightness = async (page, clip) => {
  const png = await page.screenshot({clip});
  return page.evaluate(async encoded => {
    const response = await fetch(`data:image/png;base64,${encoded}`);
    const image = await createImageBitmap(await response.blob());
    const canvas = document.createElement('canvas');
    canvas.width = image.width; canvas.height = image.height;
    const context = canvas.getContext('2d');
    context.drawImage(image, 0, 0); image.close();
    const {data} = context.getImageData(0, 0, canvas.width, canvas.height);
    let sum = 0;
    for (let i = 0; i < data.length; i += 4) sum += data[i] * .2126 + data[i + 1] * .7152 + data[i + 2] * .0722;
    return sum / (data.length / 4);
  }, png.toString('base64'));
};

try {
  const page = await browser.newPage({viewport: {width: 1000, height: 850}});
  await ready(page);
  assert((await state(page)).poolState.enabled, 'pool enabled on first load');
  await page.screenshot({path: `/tmp/droppie-pool-v2-${engine}-desktop.png`});
  await page.waitForFunction(() => window.dropletDebug.sleeping, {}, {timeout: 20000});
  const beforeWaterTap = (await state(page)).poolState.energy;
  await page.mouse.click(...(await state(page)).waterScreen);
  await page.waitForFunction(before => window.dropletDebug.poolState.energy > before + .0003, beforeWaterTap, {timeout: 10000});
  assert((await state(page)).poolState.maxHeight > .001, 'water tap produces visible waves');
  await page.screenshot({path: `/tmp/droppie-pool-v2-${engine}-water-tap.png`});
  const beforeHop = (await state(page)).poolState.splashes;
  await page.keyboard.press('Space');
  await page.waitForFunction(before => window.dropletDebug.poolState.splashes > before, beforeHop, {timeout: 20000});
  const splashed = await state(page);
  assert(splashed.finite && splashed.volume > .8 && splashed.volume < 1.2, 'hop and water re-entry preserve the body');
  await page.screenshot({path: `/tmp/droppie-pool-v2-${engine}-splash.png`});

  await page.getByRole('button', {name: 'Toggle pool'}).click();
  let snapshot = await state(page);
  assert(!snapshot.poolState.enabled && !snapshot.poolState.active, 'toggle restores dry playground');
  await page.getByRole('button', {name: 'Reset Droppie'}).click();
  assert(!(await state(page)).poolState.enabled, 'reset keeps chosen pool setting');
  const [x, y] = (await state(page)).screen;
  await page.mouse.move(x, y); await page.mouse.down();
  await page.mouse.move(x + 60, y - 65, {steps: 10});
  assert.equal((await state(page)).grabs, 1, 'existing mouse grab works');
  await page.mouse.up();
  await page.waitForFunction(() => window.dropletDebug.grabs === 0);
  await page.getByRole('button', {name: 'Reset Droppie'}).click();
  const before = (await state(page)).camera;
  await page.mouse.move(45, 650); await page.mouse.down();
  await page.mouse.move(140, 685, {steps: 8}); await page.mouse.up();
  await page.waitForTimeout(200);
  const after = (await state(page)).camera;
  assert(Math.hypot(...after.map((v, i) => v - before[i])) > .001, 'floor drag still orbits');
  await page.getByRole('button', {name: 'Mute sound'}).click();
  assert.equal(await page.getByRole('button', {name: 'Enable sound'}).getAttribute('aria-pressed'), 'true');
  await page.getByRole('button', {name: 'Toggle pool'}).click();
  await page.getByRole('button', {name: 'Reset Droppie'}).click();
  snapshot = await state(page);
  assert(snapshot.poolState.enabled && !snapshot.poolState.active, 'reset clears pool effects');
  assert(Math.hypot(snapshot.center[0], snapshot.center[2]) < .005, 'reset restores starting position');
  await page.close();

  const mobile = await browser.newContext({viewport: {width: 390, height: 844}, deviceScaleFactor: 2, ...(!useFirefox ? {isMobile: true} : {}), hasTouch: true});
  const phone = await mobile.newPage();
  await ready(phone);
  await phone.screenshot({path: `/tmp/droppie-pool-v2-${engine}-mobile.png`});
  // The tabletop used to win the depth test against the basin on some frames,
  // darkening the entire pool. Average a wide floor band so a moving local
  // shadow or caustic is not mistaken for the whole-pool brightness switch.
  await phone.waitForFunction(() => window.dropletDebug.sleeping, {}, {timeout: 20000});
  const dragStart = (await state(phone)).screen;
  const probe = {x: 20, y: Math.round(dragStart[1]) - 35, width: 350, height: 90};
  const brightness = [await floorBrightness(phone, probe)];
  await phone.mouse.move(...dragStart); await phone.mouse.down();
  for (let i = 0; i < 16; i++) {
    await phone.mouse.move(dragStart[0] + Math.sin(i * Math.PI / 5) * 45, dragStart[1] - 8, {steps: 3});
    brightness.push(await floorBrightness(phone, probe));
  }
  await phone.mouse.up();
  const brightnessRange = Math.max(...brightness) - Math.min(...brightness);
  assert(brightnessRange < brightness[0] * .16, `pool stays lit during dragging (brightness range ${brightnessRange.toFixed(1)})`);
  await phone.getByRole('button', {name: 'Reset Droppie'}).click();
  const point = (await state(phone)).screen;
  const cdp = useFirefox ? null : await mobile.newCDPSession(phone);
  if (cdp) {
    await cdp.send('Input.dispatchTouchEvent', {type: 'touchStart', touchPoints: [{x: point[0], y: point[1], id: 1}]});
    await cdp.send('Input.dispatchTouchEvent', {type: 'touchMove', touchPoints: [{x: point[0] + 25, y: point[1] - 40, id: 1}]});
  } else {
    await phone.mouse.move(...point); await phone.mouse.down();
    await phone.mouse.move(point[0] + 25, point[1] - 40, {steps: 8});
  }
  assert.equal((await state(phone)).grabs, 1, 'mobile touch grabs through the pool');
  if (cdp) await cdp.send('Input.dispatchTouchEvent', {type: 'touchEnd', touchPoints: []});
  else await phone.mouse.up();
  await phone.waitForFunction(() => window.dropletDebug.grabs === 0);
  await phone.getByRole('button', {name: 'Reset Droppie'}).click();
  const target = (await state(phone)).screen;
  await phone.touchscreen.tap(...target);
  await phone.waitForFunction(() => window.dropletDebug.poolState.active, {}, {timeout: 20000});
  await phone.setViewportSize({width: 844, height: 390});
  await phone.waitForTimeout(200);
  await phone.screenshot({path: `/tmp/droppie-pool-v2-${engine}-landscape.png`});
  assert((await state(phone)).finite, 'rotation and mobile water interaction remain finite');
  await phone.getByRole('button', {name: 'Toggle pool'}).click();
  assert.equal(await phone.getByRole('button', {name: 'Toggle pool'}).getAttribute('aria-pressed'), 'false');
  await Promise.all(consoleJobs);
  assert.deepEqual(errors, [], 'no browser, shader or WebGPU errors');
  console.log(`Pool ${engine} browser passed: desktop/mobile rendering, water-tap waves, splash, grab/release, orbit, reset, toggle, sound and rotation.`);
} finally {
  await browser.close();
}
