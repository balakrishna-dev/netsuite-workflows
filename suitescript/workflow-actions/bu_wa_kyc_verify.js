/**
 * @NApiVersion 2.1
 * @NScriptType WorkflowActionScript
 * @description KYC & sanctions screening via external provider.
 */
define(['N/https', 'N/runtime', 'N/log'], (https, runtime, log) => {

  const onAction = ({ newRecord: customer }) => {
    const endpoint = runtime.getCurrentScript().getParameter({ name: 'custscript_bu_kyc_url' });

    const res = https.post({
      url: endpoint,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: customer.getValue('companyname'),
        country: customer.getValue('billcountry'),
        taxId: customer.getValue('vatregnumber')
      })
    });

    if (res.code !== 200) {
      log.error('KYC provider error', res.body);
      return 'FAILED';
    }

    const { status, riskLevel } = JSON.parse(res.body);
    customer.setValue({ fieldId: 'custentity_bu_kyc_risk', value: riskLevel });
    return status === 'CLEAR' ? 'VERIFIED' : 'FAILED';
  };

  return { onAction };
});
