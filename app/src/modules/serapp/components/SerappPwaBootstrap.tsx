/** Inline bootstrap — must run before React so beforeinstallprompt is not missed. */
export default function SerappPwaBootstrap() {
  return (
    <script
      dangerouslySetInnerHTML={{
        __html: `(function(){try{
window.__serappInstall=window.__serappInstall||{prompt:null};
window.addEventListener('beforeinstallprompt',function(e){
  e.preventDefault();
  window.__serappInstall.prompt=e;
  window.dispatchEvent(new Event('serapp-install-ready'));
});
window.addEventListener('appinstalled',function(){
  window.__serappInstall.prompt=null;
  window.dispatchEvent(new Event('serapp-install-ready'));
});
if('serviceWorker' in navigator){
  navigator.serviceWorker.register('/serapp/sw.js',{scope:'/serapp/'})
    .then(function(r){return r.update()}).catch(function(){});
}
}catch(e){}})();`,
      }}
    />
  )
}
