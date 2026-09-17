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
  let session;
  try {
    if (fragment.has('id')) {
      session = Object.fromEntries(fragment);
      if (!/^mv_[a-f0-9]{32}$/.test(session.id) || !session.storeId || !session.channelKey
        || !Number.isFinite(Date.parse(session.expiresAt))) throw new Error('invalid');
      session.mode = session.mode === 'web' ? 'web' : 'app';
      sessionStorage.setItem(storageKey, JSON.stringify(session));
      history.replaceState(null, '', bridgeUrl.pathname);
    } else {
      session = JSON.parse(sessionStorage.getItem(storageKey) || 'null');
    }
    if (!session || Date.parse(session.expiresAt) <= Date.now()) throw new Error('expired');
  } catch {
    message.textContent = '인증 요청이 없거나 시간이 지났어요. MyVerse 설정에서 다시 시작해주세요.';
    return;
  }
  function finish(failed) {
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
  if (!window.PortOne?.requestIdentityVerification) {
    message.textContent = '인증 화면을 불러오지 못했어요. 연결을 확인한 뒤 MyVerse에서 다시 시도해주세요.';
    return;
  }
  start.hidden = false;
  start.addEventListener('click', async () => {
    if (Date.parse(session.expiresAt) <= Date.now()) {
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
