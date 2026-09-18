// Run with Playwright installed; PLAYWRIGHT_MODULE may point to its module path.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');

(async () => {
  const root = path.resolve(__dirname, '..');
  const url = 'https://identity.example.test/identity.html';
  const storageKey = 'myverse:pass:bridge:v1';
  const browser = await chromium.launch({headless:true});
  try {
    const context = await browser.newContext({viewport:{width:390,height:844}});
    const page = await context.newPage();
    const errors = [];
    let sdkLoads = 0, sequence = 0;
    page.on('pageerror', error => errors.push(error.message));
    await page.route(/https?:\/\/identity\.example\.test\//, route => {
      const name = new URL(route.request().url()).pathname;
      if (!['/identity.html', '/identity.js'].includes(name)) return route.fulfill({status:404});
      return route.fulfill({contentType:name.endsWith('.js')?'application/javascript':'text/html',body:fs.readFileSync(path.join(root,name))});
    });
    await page.route('https://cdn.portone.io/**', route => {
      sdkLoads++;
      return route.fulfill({contentType:'application/javascript',body:"window.sdkLocation=location.href;window.PortOne={requestIdentityVerification:async request=>{window.captured=request;return window.result||{identityVerificationId:request.identityVerificationId}}}"});
    });
    const id='mv_'+ 'a'.repeat(32);
    const fresh = () => ({id,storeId:'store-test',channelKey:'channel-test',expiresAt:new Date(Date.now()+600000).toISOString(),mode:'web'});
    const open = async (fields=fresh()) => page.goto(`${url}?fixture=${++sequence}#${new URLSearchParams(fields)}`);
    const clean = async () => {
      assert.equal(new URL(page.url()).hash,'');
      assert.equal(new URL(page.url()).search,'');
    };
    const cleared = async () => assert.equal(await page.evaluate(k=>sessionStorage.getItem(k),storageKey),null);

    await page.goto(`${url}?ci=PRIVATE_CI&di=PRIVATE_DI&code=FAILED`);
    assert.match(await page.locator('#message').textContent(), /요청이 없거나/);
    await clean(); await cleared(); assert.equal(sdkLoads,0);

    await open({...fresh(),expiresAt:'2000-01-01T00:00:00Z',di:'PRIVATE_DI'});
    assert.equal(await page.locator('#start').isVisible(),false);
    await clean(); await cleared(); assert.equal(sdkLoads,0);

    await open({...fresh(),id:'forged',ci:'PRIVATE_CI'});
    await clean(); await cleared(); assert.equal(sdkLoads,0);

    await page.goto(`${url}?fixture=${++sequence}#${new URLSearchParams(fresh())}&id=${id}`);
    await clean(); await cleared(); assert.equal(sdkLoads,0);

    await open({...fresh(),ci:'PRIVATE_CI',di:'PRIVATE_DI',token:'PRIVATE_TOKEN'});
    await page.locator('#start').waitFor({state:'visible'});
    await clean();
    assert.equal(await page.evaluate(()=>window.sdkLocation),url);
    assert.equal((await page.evaluate(k=>sessionStorage.getItem(k),storageKey)).includes('PRIVATE'),false);
    await page.locator('#start').click();
    assert.match(await page.locator('#message').textContent(), /인증 결과 확인/);
    await cleared();
    const captured=await page.evaluate(()=>window.captured);
    assert.equal(captured.identityVerificationId,id);
    assert.equal(captured.bypass.danal.AGELIMIT,19);
    assert.equal(captured.redirectUrl,url);
    assert.equal(Object.keys(captured).some(k=>/token|secret|name|phone|birth/i.test(k)),false);

    await page.reload();
    assert.equal(await page.locator('#start').isVisible(),false);
    await cleared();

    for (const query of [`identityVerificationId=${id}`, 'identityVerificationId=forged', `identityVerificationId=${id}&code=USER_CANCEL&message=<script>alert(1)</script>&di=PRIVATE_DI`]) {
      await open(); await page.locator('#start').waitFor({state:'visible'});
      const before=sdkLoads;
      await page.goto(`${url}?${query}`);
      assert.match(await page.locator('#message').textContent(), query===`identityVerificationId=${id}`?/인증 결과 확인/:/완료되지 않았어요/);
      await clean(); await cleared(); assert.equal(sdkLoads,before);
      assert.equal(await page.locator('#return').isVisible(),false);
    }

    await page.evaluate(k=>sessionStorage.setItem(k,'{"id":"forged","ci":"PRIVATE_CI"}'),storageKey);
    await page.reload(); await cleared();
    assert.equal(await page.locator('#start').isVisible(),false);

    await page.goto(`${url.replace('https:','http:')}#${new URLSearchParams(fresh())}`);
    assert.match(await page.locator('#message').textContent(),/안전한 연결/);
    await clean(); await cleared();
    assert.equal(await page.locator('#start').isVisible(),false);
    assert.deepEqual(errors,[]);
    console.log('PASS: URL/PII cleanup, invalid/expired/duplicate requests, SDK ordering, completion cleanup/replay, success/mismatch/cancel, corrupted storage, HTTPS guard; JS errors 0 (11 cases)');
    await context.close();
  } finally {await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
