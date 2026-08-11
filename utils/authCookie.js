
const authCookieOptions = {
  httpOnly: true,
  secure: false,
  sameSite: "lax",
};

export const setAuthCookie = (res, token) =>
  res.cookie("token", token, {
    ...authCookieOptions,
    maxAge: 365 * 24 * 60 * 60 * 1000,
  });

export const clearAuthCookie = (res) =>
  res.clearCookie("token", authCookieOptions);
