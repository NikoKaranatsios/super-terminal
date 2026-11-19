function deliverNotification({Notification,options,onClick,retain=new Set(),timeoutMs=2500}) {
  if(!Notification.isSupported())return Promise.resolve({status:'unavailable',message:'Desktop notifications are unavailable on this system.'});
  return new Promise(resolve=>{
    let notification,timer,settled=false;
    const finish=(status,message)=>{if(settled)return;settled=true;clearTimeout(timer);resolve({status,message});};
    try {
      notification=new Notification(options);retain.add(notification);
      const release=()=>retain.delete(notification);
      notification.on('click',()=>Promise.resolve(onClick?.()).catch(()=>{}));
      notification.on('show',()=>finish('shown','macOS reported the notification shown. Banner and sound depend on your notification settings.'));
      notification.on('failed',(_event,error)=>{release();finish('failed','Notification failed: '+String(error || 'The operating system rejected it.').slice(0,400));});
      notification.on('close',release);
      timer=setTimeout(()=>finish('submitted','Notification submitted; macOS has not confirmed display. Check its notification settings.'),timeoutMs);
      notification.show();
    } catch(error){if(notification)retain.delete(notification);finish('failed','Notification failed: '+error.message);}
  });
}
module.exports={deliverNotification};
