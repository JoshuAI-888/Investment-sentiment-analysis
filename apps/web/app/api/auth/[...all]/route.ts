import { toNextJsHandler } from 'better-auth/next-js';
import { auth } from '@/services/auth';

/** F02 §4.1. Mounts every Better Auth endpoint (`/api/auth/sign-in/email-otp`, etc.) as-is. */
export const { GET, POST } = toNextJsHandler(auth);
