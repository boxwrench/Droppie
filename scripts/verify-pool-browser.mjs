/* global window */
import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const url = process.env.DROPPIE_URL || 'http://127.0.0.1:5180';
const browser = await chromium.launch({
  executablePath: '/usr/bin/google-chrome', headless: true,
  args: ['--no-sandbox', '--enable-unsafe-webgpu', '--use-angle=swiftshader', '--enable-features=Vulkan'],
});
const errors = [];
const watch = page => {
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
};
const state = page => page.evaluate(() => window.dropletDebug);
const ready = async page => {
  watch(page);
  await page.goto(url);
  await page.locator('#loading.hidden').waitFor({timeout: 60000});
  assert((await state(page)).finite, 'finite body at startup');
};

try {
  const page = await browser.newPage({viewport: {width: 1000, height: 850}});
  await ready(page);
  assert((await state(page)).poolState.enabled, 'pool enabled on first load');
  await page.screenshot({path: '/tmp/droppie-pool-desktop.png'});
  await page.waitForFunction(() => window.dropletDebug.sleeping, {}, {timeout: 20000});
  await page.keyboard.press('Space');
  await page.waitForFunction(() => window.dropletDebug.poolState.active, {}, {timeout: 20000});
  const splashed = await state(page);
  assert(splashed.finite && splashed.volume > .8 && splashed.volume < 1.2, 'hop and water re-entry preserve the body');
  await page.screenshot({path: '/tmp/droppie-pool-splash.png'});

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

  const mobile = await browser.newContext({viewport: {width: 390, height: 844}, deviceScaleFactor: 2, isMobile: true, hasTouch: true});
  const phone = await mobile.newPage();
  await ready(phone);
  await phone.screenshot({path: '/tmp/droppie-pool-mobile.png'});
  const point = (await state(phone)).screen;
  const cdp = await mobile.newCDPSession(phone);
  await cdp.send('Input.dispatchTouchEvent', {type: 'touchStart', touchPoints: [{x: point[0], y: point[1], id: 1}]});
  await cdp.send('Input.dispatchTouchEvent', {type: 'touchMove', touchPoints: [{x: point[0] + 25, y: point[1] - 40, id: 1}]});
  assert.equal((await state(phone)).grabs, 1, 'mobile touch grabs through the pool');
  await cdp.send('Input.dispatchTouchEvent', {type: 'touchEnd', touchPoints: []});
  await phone.waitForFunction(() => window.dropletDebug.grabs === 0);
  await phone.getByRole('button', {name: 'Reset Droppie'}).click();
  const target = (await state(phone)).screen;
  await phone.touchscreen.tap(...target);
  await phone.waitForFunction(() => window.dropletDebug.poolState.active, {}, {timeout: 20000});
  await phone.setViewportSize({width: 844, height: 390});
  await phone.waitForTimeout(200);
  await phone.screenshot({path: '/tmp/droppie-pool-landscape.png'});
  assert((await state(phone)).finite, 'rotation and mobile water interaction remain finite');
  await phone.getByRole('button', {name: 'Toggle pool'}).click();
  assert.equal(await phone.getByRole('button', {name: 'Toggle pool'}).getAttribute('aria-pressed'), 'false');
  assert.deepEqual(errors, [], 'no browser, shader or WebGPU errors');
  console.log('Pool browser passed: desktop/mobile rendering, splash, grab/release, orbit, reset, toggle, sound and rotation.');
} finally {
  await browser.close();
}
