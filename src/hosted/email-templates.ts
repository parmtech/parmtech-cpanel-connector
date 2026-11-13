import {escapeHtml} from './presentation.js';
type Message={subject:string;text:string;html:string};
function shell(heading:string,body:string):string {
 return `<!doctype html><html lang="en"><body style="margin:0;background:#f2f5f9;font-family:Arial,sans-serif;color:#1d3045"><table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td align="center" style="padding:40px 16px"><table role="presentation" width="560" style="width:100%;max-width:560px;border:1px solid #dce5ec;border-radius:16px;background:white" cellspacing="0" cellpadding="0"><tr><td style="padding:30px 32px;background:#132d39;color:#d4eee7;border-radius:16px 16px 0 0;font-size:12px;font-weight:bold;letter-spacing:2px">PARMTECH / HOSTING CONNECTOR</td></tr><tr><td style="padding:32px"><h1 style="font-size:25px;line-height:1.3;margin:0 0 20px">${escapeHtml(heading)}</h1>${body}<p style="font-size:12px;line-height:1.7;color:#7a8797;border-top:1px solid #e6edf3;padding-top:22px;margin-top:30px">If you did not request this, you can ignore this email. Never share verification codes or passwords in chat.</p></td></tr></table><p style="font-size:11px;color:#8392a3">PARMTECH · Hosting Connector</p></td></tr></table></body></html>`;
}
export function setupCodeEmail(code:string):Message {
 if(!/^\d{8}$/.test(code))throw Error('Invalid setup code');
 return {subject:'Your PARMTECH administrator setup code',
 text:`Your administrator setup code is: ${code}\n\nThis code expires in 15 minutes. Enter it in the same browser tab where you started setup, then choose your new password.\n\nIf you did not request this, ignore this email. Never share this code or your password in chat.\n\nPARMTECH Hosting Connector`,
 html:shell('Verify your email address',`<p style="line-height:1.8;color:#617186">Use this code to finish setting up your administrator account.</p><div style="padding:22px;background:#edf6f3;border:1px solid #cfe6dc;border-radius:10px;text-align:center;font-size:32px;letter-spacing:8px;font-weight:bold;color:#196d62">${code}</div><p style="font-size:13px;line-height:1.8;color:#617186">Valid for <strong>15 minutes</strong>. Return to the original setup tab, enter the code and create your password.</p>`)};
}
export function profileVerificationEmail(url:string):Message {
 const parsed=new URL(url);if(!['https:','http:'].includes(parsed.protocol))throw Error('Invalid verification URL');
 return {subject:'Verify your PARMTECH connector profile',text:`Verify your connector profile using this link:\n${url}\n\nIf you did not request this, ignore this email.\n\nPARMTECH Hosting Connector`,
 html:shell('Confirm your connector profile',`<p style="line-height:1.8;color:#617186">Verify your email address to continue connecting your hosting account.</p><p style="margin:28px 0"><a href="${escapeHtml(url)}" style="display:inline-block;background:#176b73;color:white;padding:14px 22px;border-radius:8px;text-decoration:none;font-weight:bold">Verify email address</a></p><p style="font-size:12px;line-height:1.7;color:#617186">Use the browser where you started connecting. If the authorization has expired, start a new connection from your MCP client.</p>`)};
}
