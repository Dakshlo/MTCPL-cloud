;!function(){try { var e="undefined"!=typeof globalThis?globalThis:"undefined"!=typeof global?global:"undefined"!=typeof window?window:"undefined"!=typeof self?self:{},n=(new e.Error).stack;n&&((e._debugIds|| (e._debugIds={}))[n]="6c76cc28-7eff-cadb-ccf9-fafc8b666e7c")}catch(e){}}();
module.exports=[524882,a=>{"use strict";var b=a.i(187924),c=a.i(572131),d=a.i(295445);function e(a){let b=a.replace(/\D/g,"");return 10===b.length?`+91${b}`:(12===b.length&&b.startsWith("91"),`+${b}`)}a.s(["AuthForm",0,function(){let a=(0,d.createBrowserSupabaseClient)(),[f,g]=(0,c.useState)("phone"),[h,i]=(0,c.useState)(""),[j,k]=(0,c.useState)(""),[l,m]=(0,c.useState)(""),[n,o]=(0,c.useState)(!1),[p,q]=(0,c.useState)(!1);async function r(b){b.preventDefault(),o(!0),m("");try{let b=e(h),c=a.auth.signInWithOtp({phone:b}),d=new Promise(a=>setTimeout(()=>a({error:Error("Request timed out — server didn't respond in 20 seconds. Check network or contact support.")}),2e4)),f=(await Promise.race([c,d])).error;if(f)throw f;g("otp")}catch(c){let a=c instanceof Error?c.message:String(c);console.error("[auth-form] signInWithOtp failed:",c);let b=a;a.toLowerCase().includes("rate limit")?b+="\n\nTip: SMS provider has hit a rate limit. Wait 60 seconds and retry.":a.toLowerCase().includes("signup")||a.toLowerCase().includes("disabled")?b+="\n\nTip: This phone number isn't registered. Ask the developer to add it to the profiles table first.":a.toLowerCase().includes("timed out")&&(b+="\n\nTip: Check your internet connection. If it's working, the Supabase project / SMS provider may be down."),m(b)}finally{o(!1)}}async function s(b){b.preventDefault(),o(!0),m("");try{let b=e(h),{error:c}=await a.auth.verifyOtp({phone:b,token:j.trim(),type:"sms"});if(c)throw c;o(!1),q(!0),setTimeout(()=>{window.location.href="/"},2e3);return}catch(a){m(a instanceof Error?a.message:"Invalid or expired code. Try again."),o(!1)}}return(0,c.useEffect)(()=>{"otp"!==f||6!==j.length||n||p||s({preventDefault:()=>{}})},[j,f]),(0,b.jsxs)("div",{style:{position:"relative"},children:[(0,b.jsx)("style",{children:`
        @keyframes mtcpl-spin {
          to { transform: rotate(360deg); }
        }
        @keyframes mtcpl-fade-up {
          from { transform: translateY(8px); opacity: 0; }
          to   { transform: translateY(0); opacity: 1; }
        }
        @keyframes mtcpl-success-pop {
          0%   { transform: scale(0.4); opacity: 0; }
          60%  { transform: scale(1.08); opacity: 1; }
          100% { transform: scale(1); opacity: 1; }
        }
        /* Daksh May 2026 round 2 — the success-glow box. Pulses an
         * orange-red shadow outward while a white loader spins
         * inside. Matches the Instagram reel dad referenced:
         * "verified successfully" sits above, a glowing rounded
         * square with a spinner is the focal point. */
        @keyframes mtcpl-success-glow {
          0%, 100% {
            box-shadow:
              0 0 32px 8px rgba(249, 115, 22, 0.45),
              0 0 64px 16px rgba(220, 38, 38, 0.25),
              inset 0 0 24px 4px rgba(249, 115, 22, 0.30);
            transform: scale(1);
          }
          50% {
            box-shadow:
              0 0 48px 12px rgba(249, 115, 22, 0.65),
              0 0 96px 24px rgba(220, 38, 38, 0.40),
              inset 0 0 32px 6px rgba(249, 115, 22, 0.45);
            transform: scale(1.04);
          }
        }
        @keyframes mtcpl-aura-rotate {
          to { transform: rotate(360deg); }
        }
        .mtcpl-spinner {
          display: inline-block;
          width: 14px;
          height: 14px;
          border: 2px solid currentColor;
          border-top-color: transparent;
          border-radius: 50%;
          animation: mtcpl-spin 0.7s linear infinite;
          vertical-align: -2px;
          margin-right: 8px;
        }
      `}),p&&(0,b.jsxs)("div",{"aria-live":"polite","aria-label":"Verified successfully — taking you in",style:{position:"absolute",inset:-36,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:28,padding:"60px 36px",background:"var(--surface, #fff)",borderRadius:16,zIndex:10,animation:"mtcpl-fade-up 0.32s ease-out both"},children:[(0,b.jsx)("h2",{style:{fontSize:22,fontWeight:800,color:"var(--text)",letterSpacing:"-0.01em",margin:0,textAlign:"center",animation:"mtcpl-fade-up 0.4s 0.06s both"},children:"Verified successfully"}),(0,b.jsx)("div",{style:{position:"relative",width:96,height:96,borderRadius:22,background:"linear-gradient(135deg, #f97316 0%, #ea580c 50%, #dc2626 100%)",display:"flex",alignItems:"center",justifyContent:"center",animation:"mtcpl-success-pop 0.48s cubic-bezier(0.34, 1.56, 0.64, 1) both, mtcpl-success-glow 1.8s ease-in-out 0.5s infinite"},children:(0,b.jsx)("span",{"aria-hidden":!0,style:{display:"block",width:44,height:44,border:"4px solid rgba(255, 255, 255, 0.92)",borderTopColor:"transparent",borderRadius:"50%",animation:"mtcpl-aura-rotate 0.8s linear infinite"}})}),(0,b.jsx)("p",{style:{fontSize:12.5,color:"var(--muted)",margin:0,letterSpacing:"0.04em",textTransform:"uppercase",fontWeight:600,animation:"mtcpl-fade-up 0.4s 0.12s both"},children:"Taking you in…"})]}),(0,b.jsx)("h2",{style:{marginBottom:6,fontSize:22,fontWeight:800,letterSpacing:"-0.01em"},children:"Sign in to MTCPL"}),(0,b.jsx)("p",{className:"muted",style:{fontSize:13,marginBottom:24},children:"Enter your mobile number to receive a one-time code"}),"phone"===f?(0,b.jsxs)("form",{onSubmit:r,style:{display:"flex",flexDirection:"column",gap:14},children:[(0,b.jsxs)("label",{className:"stack",children:[(0,b.jsx)("span",{children:"Mobile Number"}),(0,b.jsxs)("div",{style:{display:"flex",gap:0},children:[(0,b.jsx)("span",{style:{display:"flex",alignItems:"center",padding:"0 12px",background:"var(--surface-alt)",border:"1px solid var(--border)",borderRight:"none",borderRadius:"8px 0 0 8px",fontSize:14,color:"var(--muted)",flexShrink:0,whiteSpace:"nowrap",fontWeight:600},children:"🇮🇳 +91"}),(0,b.jsx)("input",{type:"tel",placeholder:"",value:h,onChange:a=>i(a.target.value),required:!0,maxLength:10,style:{borderRadius:"0 8px 8px 0",flex:1,fontSize:16,letterSpacing:"0.04em",fontFamily:"ui-monospace, monospace",padding:"10px 14px"},inputMode:"numeric",pattern:"[0-9]*",autoFocus:!0})]})]}),(0,b.jsx)("button",{className:"primary-button",disabled:n||h.replace(/\D/g,"").length<10,type:"submit",style:{marginTop:4,padding:"11px 16px",fontSize:14,fontWeight:700,transition:"opacity 0.15s ease"},children:n?(0,b.jsxs)(b.Fragment,{children:[(0,b.jsx)("span",{className:"mtcpl-spinner"}),"Sending code…"]}):"Send OTP →"})]}):(0,b.jsxs)("form",{onSubmit:s,style:{display:"flex",flexDirection:"column",gap:14,position:"relative"},children:[(0,b.jsxs)("div",{style:{background:"var(--surface-alt)",border:"1px solid var(--border)",borderRadius:10,padding:"10px 14px",fontSize:13,display:"flex",alignItems:"center",justifyContent:"space-between",gap:12},children:[(0,b.jsxs)("span",{children:["Code sent to ",(0,b.jsxs)("strong",{children:["+91 ",h]})]}),(0,b.jsx)("button",{type:"button",onClick:()=>{g("phone"),k(""),m("")},disabled:p,style:{background:"none",border:"none",color:"var(--gold)",cursor:p?"not-allowed":"pointer",fontSize:12,fontWeight:700,padding:0,whiteSpace:"nowrap"},children:"Change"})]}),(0,b.jsxs)("label",{className:"stack",children:[(0,b.jsx)("span",{children:"6-digit OTP"}),(0,b.jsx)("input",{type:"text",placeholder:"– – – – – –",value:j,onChange:a=>k(a.target.value.replace(/\D/g,"").slice(0,6)),required:!0,maxLength:6,inputMode:"numeric",pattern:"[0-9]*",disabled:p,style:{letterSpacing:12,fontSize:24,textAlign:"center",fontFamily:"ui-monospace, monospace",fontWeight:700,padding:"12px 14px",borderRadius:10,color:"var(--text)",transition:"border-color 0.18s ease, background 0.18s ease"},autoFocus:!0})]}),(0,b.jsx)("button",{className:"primary-button",disabled:n||p||j.length<6,type:"submit",style:{marginTop:4,padding:"11px 16px",fontSize:14,fontWeight:700,transition:"background 0.2s ease, opacity 0.15s ease"},children:n?(0,b.jsxs)(b.Fragment,{children:[(0,b.jsx)("span",{className:"mtcpl-spinner"}),"Verifying…"]}):"Verify & Sign in"}),(0,b.jsx)("button",{type:"button",className:"ghost-button",onClick:r,disabled:n||p,style:{fontSize:13},children:"Resend code"})]}),l?(0,b.jsx)("p",{style:{marginTop:14,fontSize:13,color:"var(--danger)",whiteSpace:"pre-wrap",lineHeight:1.5},children:l}):null]})}])}];

//# debugId=6c76cc28-7eff-cadb-ccf9-fafc8b666e7c
//# sourceMappingURL=src_components_auth-form_tsx_0x.4eko._.js.map