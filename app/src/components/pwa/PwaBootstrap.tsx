import Script from 'next/script'

/** Site-wide PWA bootstrap — runs before React so install prompt is not missed. */
export default function PwaBootstrap() {
  const enableSw = process.env.NODE_ENV === 'production'

  return (
    <Script id="pwa-bootstrap" strategy="beforeInteractive">
      {`(function(){try{
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
if(!('serviceWorker' in navigator)) return;
var enableSw=${enableSw ? 'true' : 'false'};
navigator.serviceWorker.getRegistrations().then(function(regs){
  if(!enableSw){
    regs.forEach(function(reg){ reg.unregister().catch(function(){}); });
    if(window.caches){
      caches.keys().then(function(keys){
        keys.forEach(function(k){ caches.delete(k); });
      });
    }
    return;
  }
  var origin=location.origin;
  regs.forEach(function(reg){
    var scope=reg.scope||'';
    if(scope!==origin+'/'&&scope!==origin){
      reg.unregister().catch(function(){});
    }
  });
}).then(function(){
  if(!enableSw) return;
  return navigator.serviceWorker.register('/sw.js',{scope:'/'});
}).catch(function(){});
}catch(e){}})();`}
    </Script>
  )
}
