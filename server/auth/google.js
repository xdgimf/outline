// @flow
import Router from 'koa-router';
import addMonths from 'date-fns/add_months';
import { capitalize } from 'lodash';
import { OAuth2Client } from 'google-auth-library';
import { User, Team } from '../models';

const router = new Router();
const client = new OAuth2Client(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  `${process.env.URL}/auth/google.callback`
);

// start the oauth process and redirect user to Google
router.get('google', async ctx => {
  // Generate the url that will be used for the consent dialog.
  const authorizeUrl = client.generateAuthUrl({
    access_type: 'offline',
    scope: [
      'https://www.googleapis.com/auth/userinfo.profile',
      'https://www.googleapis.com/auth/userinfo.email',
    ],
    prompt: 'consent',
  });
  ctx.redirect(authorizeUrl);
});

// signin callback from Google
router.get('google.callback', async ctx => {
  const { code } = ctx.request.query;
  ctx.assertPresent(code, 'code is required');
  const response = await client.getToken(code);
  client.setCredentials(response.tokens);

  const profile = await client.request({
    url: 'https://www.googleapis.com/oauth2/v1/userinfo',
  });

  if (!profile.data.hd) {
    ctx.redirect('/?notice=google-hd');
    return;
  }

  const teamName = capitalize(profile.data.hd.split('.')[0]);
  const [team, isFirstUser] = await Team.findOrCreate({
    where: {
      googleId: profile.data.hd,
    },
    defaults: {
      name: teamName,
      avatarUrl: `https://logo.clearbit.com/${profile.data.hd}`,
    },
  });

  const [user] = await User.findOrCreate({
    where: {
      service: 'google',
      serviceId: profile.data.id,
      teamId: team.id,
    },
    defaults: {
      name: profile.data.name,
      email: profile.data.email,
      isAdmin: isFirstUser,
      avatarUrl: profile.data.picture,
    },
  });

  if (isFirstUser) {
    await team.createFirstCollection(user.id);
  }

  ctx.cookies.set('lastSignedIn', 'google', {
    httpOnly: false,
    expires: new Date('2100'),
  });
  ctx.cookies.set('accessToken', user.getJwtToken(), {
    httpOnly: false,
    expires: addMonths(new Date(), 1),
  });

  ctx.redirect('/');
});

export default router;
