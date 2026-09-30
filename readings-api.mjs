import {normalize} from './core.mjs';
// Existing public CWS read endpoint, unchanged from repository main.
// No token, Sheet ID, loadout endpoint or write operation is used here.
export const CWS_READINGS_URL='https://script.google.com/macros/s/AKfycbzKlIuwgFqQ4INdVpJvmB-YtYbFK1GspYEvZ9XQjhACAORv3tis7WWtc9wWr_KwrOgifQ/exec?action=readings';
export async function readCurrentCWS(fetchImpl=fetch) {
  const response=await fetchImpl(CWS_READINGS_URL,{method:'GET',redirect:'follow',signal:AbortSignal.timeout(20000)});
  if(!response.ok)throw Error('CWS reading request failed');
  const body=await response.json();
  if(body.status!=='ok'||!Array.isArray(body.data))throw Error('Unexpected CWS reading response');
  // Whitelist report fields; never carry ticket/photo/driver information through.
  const rows=body.data.map(r=>({Timestamp:r.Timestamp,Facility:r.Facility,H1:r.H1,H2:r.H2,Feeding:r.Feeding,FeedTank:r.FeedTank}));
  return normalize(rows);
}
