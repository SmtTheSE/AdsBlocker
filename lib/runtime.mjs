export const isVercel = Boolean(process.env.VERCEL);
export const isServerless = isVercel || Boolean(process.env.AWS_LAMBDA_FUNCTION_NAME);

export function canUseDiskCache() {
  return !isServerless;
}

export function canUseYtDlp() {
  if (isServerless) return false;
  if (process.env.YTDLP_DISABLED === '1') return false;
  return true;
}

export function runtimeLabel() {
  if (isVercel) return 'vercel';
  return 'node';
}
