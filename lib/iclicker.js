// Calls to iClicker's student API, copied from what student.iclicker.com does.
const API = 'https://api.iclicker.com';

export class IclickerError extends Error {
  constructor(status, body) {
    super(`iClicker HTTP ${status}: ${body.slice(0, 300)}`);
    this.status = status;
    this.body = body;
  }
}

export function decodeToken(token) {
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('not a token');
  const claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString());
  if (!claims.userId || !claims.exp) throw new Error('token missing userId or exp');
  return { userId: claims.userId, email: claims.sub, exp: claims.exp };
}

async function call(token, method, url, body, headers = {}) {
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: 'Bearer ' + token,
      'Reef-Auth-Type': 'oauth',
      'Client-Tag': 'STUDENT-WEB',
      'Content-Type': 'application/json',
      Accept: 'application/json',
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new IclickerError(res.status, text);
  return text ? JSON.parse(text) : null;
}

export async function getCourses(token) {
  const { userId } = decodeToken(token);
  const data = await call(token, 'GET', `${API}/v1/users/${userId}/views/student-courses`);
  return data.enrollments.filter((e) => !e.archived);
}

// { meetingId, attendanceStatus: { attendanceId, userPresent, requireLocation, requireBluetooth } | null }
export function getCourseStatus(token, courseId) {
  return call(token, 'POST', `${API}/student/course/status`, { courseId }, {
    'Content-Type': 'application/vnd.reef.student-course-status-request-v1+json',
    Accept: 'application/vnd.reef.student-course-status-response-v3+json',
  });
}

// The question that is open right now, or null. Same data the official class page loads.
// Returns { questionId, activityId, answerType, imageUrl, name, mine: { userQuestionId, answer, answers } | null }
export async function getOpenQuestion(token, courseId) {
  const { userId } = decodeToken(token);
  const sections = await call(token, 'GET', `${API}/v3/courses/${courseId}/class-sections?recordsPerPage=1&pageNumber=1` +
    `&expandChild=activities&expandChild=questions&expandChild=userQuestions&userId=${userId}`);
  const section = sections[0];
  if (!section || section.endDate) return null;
  for (const activity of section.activities) {
    for (const q of activity.questions) {
      if (q.started && !q.ended) {
        const mine = q.userQuestions.find((u) => u.userId === userId);
        return {
          questionId: q._id,
          activityId: q.activityId,
          answerType: q.answerType,
          imageUrl: q.ImageURL,
          name: q.name,
          mine: mine ? { userQuestionId: mine._id, answer: mine.answer, answers: mine.answers } : null,
        };
      }
    }
  }
  return null;
}

// geo: { accuracy, lat, lon } or null
export function joinClass(token, courseId, geo) {
  const body = geo ? { id: courseId, geo } : { id: courseId };
  return call(token, 'POST', `${API}/trogon/v2/course/attendance/join/${courseId}`, body);
}

// choice: { answer: 'B' } or { answers: ['A', 'C'] }
export function sendAnswer(token, question, choice) {
  const { userId } = decodeToken(token);
  const base = `${API}/v2/activities/${question.activityId}/questions/${question.questionId}/user-questions`;
  if (question.mine) {
    return call(token, 'PUT', `${base}/${question.mine.userQuestionId}`, {
      ...choice, userId, activityId: question.activityId, userQuestionId: question.mine.userQuestionId,
    });
  }
  return call(token, 'POST', base + '/', {
    ...choice, activityId: question.activityId, questionId: question.questionId, userId, clientType: 'WEB',
  });
}
