import { handleVercelRequest } from '../server/vercel-handler.mjs';
export default { fetch(request) { return handleVercelRequest(request); } };
