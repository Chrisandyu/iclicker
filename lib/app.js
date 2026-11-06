import { createHash } from 'node:crypto';
import * as real from './iclicker.js';
import { decodeToken, getCourses, getCourseStatus, IclickerError } from './iclicker.js';
import { createFake, FAKE_COURSE_ID } from './fake.js';

export function createApp(store) {
  const password = process.env.SITE_PASSWORD;
  if (!password) throw new Error('set SITE_PASSWORD');
  const fake = createFake(store);
  const sessionValue = createHash('sha256').update('iclicker-lite:' + password).digest('hex');

  return async function handle(request) {
    const url = new URL(request.url);
    const route = `${request.method} ${url.pathname}`;
    try {
      if (route === 'POST /login') return login(request, password, sessionValue);
      if (cookie(request, 's') !== sessionValue) return loginPage();
      if (route === 'GET /') return home(store, url);
      if (route === 'POST /logout') return redirect('/', 's=; Path=/; Max-Age=0');
      if (route === 'GET /token') return tokenPage(url);
      if (route === 'POST /token') return saveToken(request, store);
      if (route === 'GET /c') return coursePage(store, fake, url);
      if (route === 'POST /join') return join(request, store, fake);
      if (route === 'POST /answer') return answer(request, store, fake);
      if (route === 'GET /fake') return fakePage(fake);
      if (route === 'GET /fakestudent') return redirect(`/c?id=${FAKE_COURSE_ID}&n=FAKE%20TEST%20CLASS`);
      if (route === 'POST /fake') return fakeAction(request, fake);
      if (route === 'GET /debug') return debug(store);
      return page('not found', '<p>nothing here <a href="/">home</a></p>', 404);
    } catch (err) {
      console.error(err);
      const expired = err instanceof IclickerError && err.status === 401;
      const msg = expired ? 'login expired send a new token' : err.message;
      return page('error', `<p>${esc(msg)}</p><p><a href="/">home</a> | <a href="/token">new token</a></p>`, 500);
    }
  };
}

// ---------- pages ----------

async function login(request, password, sessionValue) {
  const form = await request.formData();
  if (form.get('pw') !== password) return page('log in', '<p>wrong password</p>' + loginForm(), 401);
  return redirect('/', `s=${sessionValue}; Path=/; Max-Age=31536000; HttpOnly; Secure`);
}

function loginPage() {
  return page('log in', '<p>not logged in</p>' + loginForm());
}

function loginForm() {
  return `<form method="post" action="/login">
<p>password<br><input type="password" name="pw"></p>
<p><input type="submit" value="log in"></p></form>`;
}

async function home(store, url) {
  const token = await store.get('token');
  let body = msg(url) + tokenStatus(token);
  if (token && !isExpired(token)) {
    const courses = await getCourses(token);
    body += '<h2>courses</h2>' + courses.map((c) =>
      `<p><a href="/c?id=${esc(c.courseId)}&amp;n=${encodeURIComponent(c.name)}">${esc(c.name)}</a></p>`).join('');
  }
  body += `<p><a href="/token">send token</a> | <a href="/debug">debug</a></p>
<form method="post" action="/logout"><input type="submit" value="log out"></form>`;
  return page('iclicker', body);
}

function tokenStatus(token) {
  if (!token) return '<p>send a token</p>';
  const t = decodeToken(token);
  const hours = (t.exp * 1000 - Date.now()) / 3600000;
  if (hours <= 0) return `<p>login EXPIRED (${esc(t.email)}) send a new token</p>`;
  return `<p>logged in as ${esc(t.email)} ${hours.toFixed(1)} h left.</p>`;
}

function isExpired(token) {
  return decodeToken(token).exp * 1000 <= Date.now();
}

function tokenPage(url) {
  const bookmarklet = `javascript:void(window.open('${url.origin}/token#'+sessionStorage.access_token))`;
  return page('send token', `
<p>log in on <a href="https://student.iclicker.com/#/courses">student.iclicker.com</a></p>
<p><b>Method 1:</b> bookmark <a href="${esc(bookmarklet)}">send</a>.
click on iclicker tab</p>
<p><b>Method 2:</b> run copy(sessionStorage.access_token) and paste in box</p>
<form method="post" action="/token" id="f">
<textarea name="token" id="t" rows="6" cols="40"></textarea>
<p><input type="submit" value="save"></p></form>
<script>
if (location.hash.length > 20) { document.getElementById('t').value = location.hash.slice(1); history.replaceState(null, '', '/token'); document.getElementById('f').submit(); }
</script>`);
}

async function saveToken(request, store) {
  const token = String((await request.formData()).get('token') || '').trim();
  if (token === 'undefined' || token === 'null' || !token) throw new Error('make sure youre logged in');
  decodeToken(token);
  if (isExpired(token)) throw new Error('that token is expired');
  await getCourses(token); // proves iClicker accepts it
  await store.set('token', token);
  return redirect('/?m=' + encodeURIComponent('token saved'));
}

async function needToken(store) {
  const token = await store.get('token');
  if (!token) throw new Error('No token saved ');
  if (isExpired(token)) throw new IclickerError(401, 'expired');
  return token;
}

// The fake test class needs no iClicker token.
async function apiFor(store, fake, courseId) {
  if (courseId === FAKE_COURSE_ID) return { api: fake, token: null };
  return { api: real, token: await needToken(store) };
}

const UNSUPPORTED_TYPES = ['TARGET_ANSWER'];

async function coursePage(store, fake, url) {
  const courseId = url.searchParams.get('id');
  const { api, token } = await apiFor(store, fake, courseId);
  const name = url.searchParams.get('n') || 'course';
  const status = await api.getCourseStatus(token, courseId);
  const live = !!status.meetingId;
  const self = `/c?id=${encodeURIComponent(courseId)}&n=${encodeURIComponent(name)}`;

  let body = `<p><a href="/">&lt; home</a></p><h2>${esc(name)}</h2>` + msg(url);
  const att = status.attendanceStatus;
  const checkedIn = !!(att && att.userPresent);
  body += `<p>live: ${live ? 'yes' : 'no'}</p><p>checked in: ${checkedIn ? 'yes' : 'no'}</p>`;
  if (live && !checkedIn) body += joinForm(courseId, name, att);
  if (live) body += questionBlock(await api.getOpenQuestion(token, courseId), courseId, name);
  const refreshSeconds = live ? 4 : 20;
  // A JS timer instead of a meta refresh, so typing or getting location can stop it.
  body += `<p>updated ${new Date().toLocaleTimeString('en-US', { timeZone: 'America/Los_Angeles' })}</p><p><a href="${esc(self)}">refresh</a></p>
<script>
var timer = setTimeout(function () { location.replace(${JSON.stringify(self).replace(/</g, '\\u003c')}); }, ${refreshSeconds * 1000});
function stopRefresh() { clearTimeout(timer); }
</script>`;
  return page(name, body);
}

function joinForm(courseId, name, att) {
  const needGeo = !!(att && att.requireLocation);
  let html = `<form method="post" action="/join" id="j">
<input type="hidden" name="id" value="${esc(courseId)}"><input type="hidden" name="n" value="${esc(name)}">
<input type="hidden" name="lat" id="lat"><input type="hidden" name="lon" id="lon"><input type="hidden" name="acc" id="acc">
<input type="submit" value="check in"${needGeo ? ' onclick="return geo()"' : ''}></form>`;
  if (att && att.requireBluetooth) html += '<p>need bluetooth :(</p>';
  if (needGeo) {
    html += `<p>check in location based</p><script>
function geo() {
  var f = document.getElementById('j');
  if (!navigator.geolocation) return true;
  stopRefresh();
  navigator.geolocation.getCurrentPosition(function (p) {
    document.getElementById('lat').value = p.coords.latitude;
    document.getElementById('lon').value = p.coords.longitude;
    document.getElementById('acc').value = p.coords.accuracy;
    f.submit();
  }, function () { f.submit(); }, { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 });
  return false;
}</script>`;
  }
  return html;
}

function shownAnswer(mine) {
  return mine.answer || (mine.answers || []).join(', ');
}

function questionBlock(q, courseId, name) {
  if (!q) return '<p>waiting for question</p>';
  const hidden = `<input type="hidden" name="id" value="${esc(courseId)}"><input type="hidden" name="n" value="${esc(name)}"><input type="hidden" name="q" value="${esc(q.questionId)}">`;
  let html = `<h2>question open</h2>
<p>${q.mine ? 'your answer: <b>' + esc(shownAnswer(q.mine)) : 'no answer'}</p>`;
  if (q.answerType === 'SINGLE_ANSWER') {
    html += `<form method="post" action="/answer">${hidden}<p>` +
      ['A', 'B', 'C', 'D', 'E'].map((l) => `<input type="submit" name="a" value="${l}">`).join(' ') + '</p></form>';
  } else if (q.answerType === 'MULTIPLE_ANSWER') {
    html += `<form method="post" action="/answer">${hidden}<p>` +
      ['A', 'B', 'C', 'D', 'E'].map((l) => `<label><input type="checkbox" name="m" value="${l}" onclick="stopRefresh()"> ${l}</label>`).join(' ') +
      '</p><p><input type="submit" value="send"></p></form>';
  } else if (UNSUPPORTED_TYPES.includes(q.answerType)) {
    html += `<p>This question (${esc(q.answerType)}) needs clicking on a picture :(</p>`;
  } else {
    html += `<form method="post" action="/answer">${hidden}<p>type answer (${esc(q.answerType)}):</p>
<input type="text" name="t" onfocus="stopRefresh()"> <input type="submit" value="send"></form>`;
  }
  if (q.imageUrl) html += `<p><a href="${esc(q.imageUrl)}">see question slide</a></p>`;
  return html;
}

async function join(request, store, fake) {
  const form = await request.formData();
  const courseId = form.get('id');
  const { api, token } = await apiFor(store, fake, courseId);
  const lat = form.get('lat');
  const geo = lat ? { lat: Number(lat), lon: Number(form.get('lon')), accuracy: Number(form.get('acc')) } : null;
  const result = await api.joinClass(token, courseId, geo);
  const text = result.result === 'ABSENT' ? 'marked absent' : 'checked in';
  return redirect(courseUrl(courseId, form.get('n'), text));
}

function choiceFrom(form) {
  if (form.get('t') !== null) return { answer: String(form.get('t')).trim() };
  if (form.get('a') !== null) return { answer: String(form.get('a')) };
  return { answers: form.getAll('m').map(String) };
}

async function answer(request, store, fake) {
  const form = await request.formData();
  const courseId = form.get('id');
  const back = (text) => redirect(courseUrl(courseId, form.get('n'), text));
  const { api, token } = await apiFor(store, fake, courseId);
  const choice = choiceFrom(form);
  if (choice.answer === '' || (choice.answers && !choice.answers.length)) return back('nothing was picked so answer not sent');
  const q = await api.getOpenQuestion(token, courseId);
  if (!q || q.questionId !== form.get('q')) return back('too late so answer not sent');
  try {
    await api.sendAnswer(token, q, choice);
  } catch (err) {
    if (err instanceof IclickerError && err.status === 403) return back('too late question ended');
    throw err;
  }
  return redirect(`/c?id=${encodeURIComponent(courseId)}&n=${encodeURIComponent(form.get('n') || '')}`);
}

async function debug(store) {
  const token = await store.get('token');
  let out = 'token: ' + (token ? JSON.stringify(decodeToken(token)) : 'none') + '\n';
  if (token && !isExpired(token)) {
    for (const c of await getCourses(token)) {
      out += `\n${c.name}\n  status: ${JSON.stringify(await getCourseStatus(token, c.courseId))}\n  open question: ${JSON.stringify(await real.getOpenQuestion(token, c.courseId))}\n`;
    }
  }
  return page('debug', `<p><a href="/">home</a></p><pre>${esc(out)}</pre>`);
}

async function fakePage(fake) {
  const s = await fake.load();
  const button = (action, label, type = '') => `<form method="post" action="/fake"><input type="hidden" name="do" value="${action}"><input type="hidden" name="type" value="${type}"><input type="submit" value="${label}"></form>`;
  const state = !s.live ? 'not live' : `live, location ${s.requireLocation ? 'required' : 'not required'}, ${s.present ? 'checked in' : 'not checked in'}, ` +
    (s.question ? `question ${s.count} ${s.question.ended ? 'closed' : 'OPEN'}` : 'no question');
  return page('fake class', `<p><a href="/">home</a></p><h2>fake class</h2>
<p>open /fakestudent</p>
<p>now: ${esc(state)}</p>
${button('start', 'start class')}${button('start-loc', 'start class (location)')}
${button('question', 'open multiple choice', 'SINGLE_ANSWER')}${button('question', 'open select multiple', 'MULTIPLE_ANSWER')}${button('question', 'open number', 'NUMERIC')}
${button('end-question', 'close question')}${button('end', 'end class')}${button('reset', 'reset')}
<p><a href="/fake">refresh</a></p>
<h3>phone</h3><pre>${esc(s.log.join('\n'))}</pre>`, 200, '<meta http-equiv="refresh" content="5">');
}

async function fakeAction(request, fake) {
  const form = await request.formData();
  await fake.control(form.get('do'), form.get('type'));
  return redirect('/fake');
}

// ---------- helpers ----------

function courseUrl(courseId, name, text) {
  return `/c?id=${encodeURIComponent(courseId)}&n=${encodeURIComponent(name || '')}&m=${encodeURIComponent(text)}`;
}

function msg(url) {
  const m = url.searchParams.get('m');
  return m ? `<p>${esc(m)}</p>` : '';
}

function cookie(request, name) {
  const header = request.headers.get('cookie') || '';
  const found = header.split(';').map((p) => p.trim()).find((p) => p.startsWith(name + '='));
  return found ? found.slice(name.length + 1) : null;
}

function redirect(location, setCookie) {
  const headers = { Location: location };
  if (setCookie) headers['Set-Cookie'] = setCookie;
  return new Response(null, { status: 303, headers });
}

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function page(title, body, status = 200, head = '') {
  const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width">${head}
<title>${esc(title)}</title></head><body>${body}</body></html>`;
  return new Response(html, { status, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } });
}
