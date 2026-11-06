import { createApp } from '../lib/app.js';
import { redisStore } from '../lib/store.js';

const handle = createApp(redisStore());

export const GET = handle;
export const POST = handle;
