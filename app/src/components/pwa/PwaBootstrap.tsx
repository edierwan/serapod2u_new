/** Site-wide PWA bootstrap — runs before React so install prompt is not missed. */
export default function PwaBootstrap() {
  return (
    <script
      dangerouslySetInnerHTML={{
        __html: `(function(){try{
window.__pwaInstall=window.__pwaInstall||{prompt:null};
window.__serappInstall=window.__pwaInstall;
window.addEventListener('beforeinstallprompt',function(e){
  e.preventDefault();
  window.__pwaInstall.prompt=e;
  window.dispatchEvent(new Event('pwa-install-ready'));
});
window.addEventListener('appinstalled',function(){
  window.__pwaInstall.prompt=null;
  window.dispatchEvent(new Event('pwa-install-ready'));
});
if('serviceWorker' in navigator){
  var origin=location.origin;
  navigator.serviceWorker.getRegistrations().then(function(regs){
    regs.forEach(function(reg){
      var scope=reg.scope||'';
      if(scope!==origin+'/'&&scope!==origin){
        reg.unregister().catch(function(){});
      }
    });
  }).finally(function(){
    navigator.serviceWorker.register('/sw.js',{scope:'/'})
      .then(function(r){return r.update()}).catch(function(){});
  });
}
}catch(e){}})();`,
      }}
    />
  )
}
