import "dotenv/config";
import passport from "passport";
import { Strategy as GoogleStrategy } from "passport-google-oauth20";

import {
  findUserByEmail,
  findUserByGoogleId,
  createGoogleUser,
  updateGoogleId,
} from "../models/User.js";

passport.use(
 new GoogleStrategy(
  {
    clientID: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    callbackURL: process.env.GOOGLE_CALLBACK_URL,
    scope: ["profile", "email"],
  },

    async (accessToken, refreshToken, profile, done) => {
      try {
        const googleId = profile.id;
        const email = profile.emails?.[0]?.value
          ?.trim()
          .toLowerCase();

        const name = profile.displayName;
        const profilePic = profile.photos?.[0]?.value || null;

        if (!email) {
          return done(null, false);
        }

        // 1. Google ID se user check
        let user = await findUserByGoogleId(googleId);

        if (user) {
          return done(null, user);
        }

        // 2. Email se existing user check
        user = await findUserByEmail(email);

        if (user) {
          // Existing account ko Google account se link
          await updateGoogleId(user.id, googleId);

          user.google_id = googleId;

          return done(null, user);
        }

        // 3. New Google user
        const result = await createGoogleUser(
          name,
          email,
          googleId,
          profilePic
        );

        user = {
          id: result.insertId,
          name,
          email,
          google_id: googleId,
          profile_pic: profilePic,
        };

        return done(null, user);
      } catch (error) {
        return done(error, null);
      }
    }
  )
);

export default passport;