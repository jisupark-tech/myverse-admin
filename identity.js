/* Public browser bridge. No app JWT, provider secret or identity data belongs here. */
(() => {
  'use strict';
  const message = document.getElementById('message');
  const start = document.getElementById('start');
  const back = document.getElementById('return');
  const storageKey = 'myverse:pass:bridge:v1';
  const callback = 'myverseapp://identity-callback';
  const bridgeUrl = new URL('./identity.html', location.href);
  const fragment = new URLSearchParams(location.hash.slice(1));
  const query = new URLSearchParams(location.search);
  // Remove even malformed/expired callback values before loading any third-party code.
  history.replaceState(null, '', bridgeUrl.pathname);
  const clear = () => { try { sessionStorage.removeItem(storageKey); } catch { /* Storage may be disabled. */ } };
  if (location.protocol !== 'https:') {
    clear();
    message.textContent = '안전한 연결이 필요해요. MyVerse에서 인증을 다시 시작해주세요.';
    return;
  }
  function validated(value) {
    if (!value || typeof value.id !== 'string' || !/^mv_[a-f0-9]{32}$/.test(value.id)
      || typeof value.storeId !== 'string' || !/^[A-Za-z0-9_-]{1,200}$/.test(value.storeId)
      || typeof value.channelKey !== 'string' || !/^[A-Za-z0-9_-]{1,200}$/.test(value.channelKey)
      || typeof value.expiresAt !== 'string' || !Number.isFinite(Date.parse(value.expiresAt))
      || Date.parse(value.expiresAt) <= Date.now()
      || Date.parse(value.expiresAt) > Date.now() + 630000) throw new Error('invalid');
    // Do not persist unknown fragment fields, identity data, error text or tokens.
    return { id: value.id, storeId: value.storeId, channelKey: value.channelKey,
      expiresAt: value.expiresAt, mode: value.mode === 'web' ? 'web' : 'app' };
  }
  let session;
  try {
    if (fragment.has('id')) {
      if (Array.from(fragment.keys()).some(key => fragment.getAll(key).length !== 1)) throw new Error('duplicate');
      session = validated(Object.fromEntries(fragment));
    } else {
      session = validated(JSON.parse(sessionStorage.getItem(storageKey) || 'null'));
    }
    sessionStorage.setItem(storageKey, JSON.stringify(session));
  } catch {
    clear();
    message.textContent = '인증 요청이 없거나 시간이 지났어요. MyVerse 설정에서 다시 시작해주세요.';
    return;
  }
  function finish(failed) {
    clear();
    start.hidden = true;
    if (session.mode === 'web') {
      message.textContent = failed ? '인증이 완료되지 않았어요. MyVerse로 돌아가 다시 시도해주세요.'
        : 'MyVerse가 열린 탭으로 돌아가 설정에서 인증 결과 확인을 눌러주세요.';
    } else {
      message.textContent = failed ? '인증이 완료되지 않았어요. MyVerse로 돌아가 다시 시도해주세요.'
        : '인증 화면에서 돌아왔어요. MyVerse에서 결과를 확인해주세요.';
      // The deep link signals completion only. The app ignores all callback claims.
      back.href = callback;
      back.hidden = false;
      if (!failed) location.replace(callback);
    }
  }
  if (query.has('identityVerificationId') || query.has('code')) {
    const mismatch = query.get('identityVerificationId') !== session.id;
    history.replaceState(null, '', bridgeUrl.pathname);
    finish(mismatch || !!query.get('code'));
    return;
  }
  // Load the SDK only for a validated request, after URL sanitization.
  const sdk = document.createElement('script');
  sdk.src = 'https://cdn.portone.io/v2/browser-sdk.js';
  sdk.referrerPolicy = 'no-referrer';
  sdk.onload = () => {
    if (window.PortOne?.requestIdentityVerification) start.hidden = false;
    else sdk.onerror();
  };
  sdk.onerror = () => {
    message.textContent = '인증 화면을 불러오지 못했어요. MyVerse에서 다시 시도해주세요.';
  };
  document.head.appendChild(sdk);
  window.addEventListener('pageshow', event => {
    if (event.persisted) location.reload();
  });
  start.addEventListener('click', async () => {
    if (Date.parse(session.expiresAt) <= Date.now()) {
      clear();
      message.textContent = '인증 시간이 지났어요. MyVerse에서 다시 시작해주세요.';
      start.hidden = true;
      return;
    }
    start.disabled = true;
    try {
      const result = await window.PortOne.requestIdentityVerification({
        storeId: session.storeId,
        channelKey: session.channelKey,
        identityVerificationId: session.id,
        redirectUrl: bridgeUrl.href,
        forceRedirect: true,
        bypass: { danal: { CPTITLE: 'MyVerse', AGELIMIT: 19 } },
      });
      if (result) finish(!!result.code || result.identityVerificationId !== session.id);
    } catch {
      message.textContent = '인증 화면을 열지 못했어요. 다시 시도해주세요.';
    } finally { start.disabled = false; }
  });
})();
