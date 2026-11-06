// A pretend iClicker class for testing. Same functions as iclicker.js, driven from /fake.
import { IclickerError } from './iclicker.js';

export const FAKE_COURSE_ID = 'fake-course';

const START = { live: false, requireLocation: false, present: false, question: null, count: 0, log: [] };

export function createFake(store) {
  const load = async () => (await store.get('fake')) || structuredClone(START);
  const save = (s) => store.set('fake', s);
  const note = (s, text) => { s.log = [new Date().toLocaleTimeString('en-US', { timeZone: 'America/Los_Angeles' }) + ' ' + text, ...s.log].slice(0, 30); };

  return {
    load,

    // Teacher buttons on /fake. type: SINGLE_ANSWER, MULTIPLE_ANSWER, NUMERIC_ANSWER or SHORT_ANSWER.
    async control(action, type) {
      const s = await load();
      if (action === 'reset') return save(structuredClone(START));
      if (action === 'start') { Object.assign(s, { live: true, requireLocation: false, present: false, question: null }); note(s, 'class started'); }
      if (action === 'start-loc') { Object.assign(s, { live: true, requireLocation: true, present: false, question: null }); note(s, 'class started (location)'); }
      if (action === 'question') {
        if (!s.live) throw new Error('start class first');
        s.count += 1;
        s.question = { questionId: 'fake-q' + s.count, activityId: 'fake-activity', answerType: type, imageUrl: null, name: 'Question ' + s.count, ended: false, mine: null };
        note(s, `question ${s.count} opened (${type})`);
      }
      if (action === 'end-question') {
        if (!s.question) throw new Error('no question open');
        s.question.ended = true;
        note(s, `question ${s.count} closed`);
      }
      if (action === 'end') { Object.assign(s, { live: false, question: null }); note(s, 'class ended'); }
      await save(s);
    },

    async getCourseStatus() {
      const s = await load();
      if (!s.live) return { meetingId: null, attendanceStatus: null };
      return { meetingId: 'fake-meeting', attendanceStatus: { attendanceId: 'fake', userPresent: s.present, requireLocation: s.requireLocation, requireBluetooth: false } };
    },

    async getOpenQuestion() {
      const s = await load();
      if (!s.question || s.question.ended) return null;
      const { ended, ...q } = s.question;
      return q;
    },

    async joinClass(token, courseId, geo) {
      const s = await load();
      const absent = s.requireLocation && !geo;
      if (!absent) s.present = true;
      note(s, absent ? 'check in failed no location' : 'checked in' + (geo ? ` at ${geo.lat}, ${geo.lon} (±${Math.round(geo.accuracy)} m)` : ''));
      await save(s);
      return { result: absent ? 'ABSENT' : 'PRESENT' };
    },

    async sendAnswer(token, question, choice) {
      const s = await load();
      if (!s.question || s.question.questionId !== question.questionId || s.question.ended) throw new IclickerError(403, 'question ended');
      s.question.mine = { userQuestionId: 'fake-uq', ...choice };
      note(s, `got ${JSON.stringify(choice)} for question ${s.count}${question.mine ? ' (changed)' : ''}`);
      await save(s);
      return choice;
    },
  };
}
