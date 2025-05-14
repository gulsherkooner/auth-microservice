// const fetch = require('node-fetch');

module.exports = async function getDbxToken() {
  const response = await fetch('https://api.dropboxapi.com/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: process.env.DROPBOX_REFRESH_TOKEN,
      client_id: process.env.DROPBOX_APP_KEY,
      client_secret: process.env.DROPBOX_APP_SECRET,
    }),
  });

  if (!response.ok) {
    const error = await response.json();
    console.error('Error refreshing token:', error);
    throw new Error(`Failed to refresh token: ${error.error_description || error.error}`);
  }

  const data = await response.json();
  return data.access_token;
}