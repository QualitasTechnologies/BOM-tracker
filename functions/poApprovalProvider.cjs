const REJECTED=Symbol('po-approval-provider-rejected');
function createPOApprovalSender({Resend,getApiKey,timeoutMs=30000}) {
  return async (mail,{idempotencyKey})=>{
    const result=await new Resend(getApiKey()).emails.send(mail,{idempotencyKey,signal:AbortSignal.timeout(timeoutMs)});
    if(result?.error||typeof result?.data?.id!=='string'||!result.data.id||result.data.id.length>512) {
      const error=Error('notification_provider_unconfirmed');
      if(['validation_error','invalid_idempotent_request'].includes(result?.error?.name))error[REJECTED]=true;
      throw error;
    }
    return{id:result.data.id};
  };
}
function createPOApprovalLookup({Resend,getApiKey,timeoutMs=15000}) {
  return async providerId=>{
    if(typeof providerId!=='string'||!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(providerId))throw Error('notification_provider_lookup_unavailable');
    try {
      // The SDK's lower-level GET accepts AbortSignal; emails.get(id) has no options in 4.8.0.
      const result=await new Resend(getApiKey()).get(`/emails/${providerId}`,{signal:AbortSignal.timeout(timeoutMs)});
      if(result?.error||!result?.data||result.data.id!==providerId)throw Error('unconfirmed');
      return result.data;
    }catch{throw Error('notification_provider_lookup_unavailable');}
  };
}
module.exports={createPOApprovalSender,createPOApprovalLookup,REJECTED};
