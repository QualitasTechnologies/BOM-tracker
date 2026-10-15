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
module.exports={createPOApprovalSender,REJECTED};
