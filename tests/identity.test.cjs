// Run with playwright installed; optionally set PLAYWRIGHT_MODULE to its module path.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');

(async () => {
  const root = path.resolve(__dirname, '..');
  const server = http.createServer((req, res) => {
    const name = new URL(req.url, 'http://localhost').pathname;
    if (!['/identity.html', '/identity.js'].includes(name)) { res.writeHead(404).end(); return; }
    res.setHeader('content-type', name.endsWith('.js') ? 'application/javascript' : 'text/html');
    res.end(fs.readFileSync(path.join(root, name)));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}/identity.html`;
  const browser = await chromium.launch({headless:true});
  try {
    const context = await browser.newContext({viewport:{width:390,height:844}});
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('https://cdn.portone.io/**', route => route.fulfill({contentType:'application/javascript',body:"window.PortOne={requestIdentityVerification:async request=>{window.captured=request;return window.result||{identityVerificationId:request.identityVerificationId}}}"}));
    await page.goto(url);
    assert.match(await page.locator('#message').textContent(), /요청이 없거나/);
    assert.equal(await page.locator('#start').isVisible(),false);
    const id='mv_'+ 'a'.repeat(32);
    const fragment = expires => new URLSearchParams({id,storeId:'store-test',channelKey:'channel-test',expiresAt:expires,mode:'web'});
    await page.goto(`${url}#${fragment('2000-01-01T00:00:00Z')}`);
    await page.reload();
    assert.equal(await page.locator('#start').isVisible(),false);
    const expires=new Date(Date.now()+600000).toISOString();
    await page.goto(`${url}#${fragment(expires)}`);
    await page.reload();
    assert.equal(await page.locator('#start').isVisible(),true);
    assert.equal(new URL(page.url()).hash,'');
    await page.screenshot({path:process.env.IDENTITY_SCREENSHOT || '/tmp/myverse-pass-bridge.png',fullPage:true});
    await page.locator('#start').click();
    assert.match(await page.locator('#message').textContent(), /인증 결과 확인/);
    const captured=await page.evaluate(()=>window.captured);
    assert.equal(captured.identityVerificationId,id);
    assert.equal(captured.bypass.danal.AGELIMIT,19);
    assert.equal(captured.redirectUrl,url);
    assert.equal(Object.keys(captured).some(k=>/token|secret|name|phone|birth/i.test(k)),false);
    await page.goto(`${url}?identityVerificationId=${id}`);
    assert.match(await page.locator('#message').textContent(), /인증 결과 확인/);
    await page.goto(`${url}?identityVerificationId=forged`);
    assert.match(await page.locator('#message').textContent(), /완료되지 않았어요/);
    await page.goto(`${url}?identityVerificationId=${id}&code=USER_CANCEL&message=<script>alert(1)</script>`);
    assert.match(await page.locator('#message').textContent(), /완료되지 않았어요/);
    assert.equal(await page.locator('#return').isVisible(),false);
    assert.deepEqual(errors,[]);
    console.log('PASS: no session, expiration, SDK launch, success, mismatch, cancellation; JS errors 0 (6 cases)');
    await context.close();
  } finally {await browser.close();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1;});
