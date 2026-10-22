/**
 * @NApiVersion 2.1
 * @NScriptType WorkflowActionScript
 * @description Validates margin & discount rules before approval.
 */
define(['N/runtime', 'N/search', 'N/log'], (runtime, search, log) => {

  const MIN_MARGIN = 0.18;

  const onAction = (ctx) => {
    const so = ctx.newRecord;
    const lines = so.getLineCount({ sublistId: 'item' });
    let revenue = 0, cost = 0;

    for (let i = 0; i < lines; i++) {
      revenue += Number(so.getSublistValue({ sublistId: 'item', fieldId: 'amount', line: i }));
      cost    += Number(so.getSublistValue({ sublistId: 'item', fieldId: 'costestimate', line: i }));
    }

    const margin = revenue ? (revenue - cost) / revenue : 0;
    so.setValue({ fieldId: 'custbody_bu_margin_pct', value: margin * 100 });

    if (margin < MIN_MARGIN) {
      log.audit('Low margin order', { id: so.id, margin });
      return 'LOW_MARGIN';   // drives the next transition
    }
    return 'OK';
  };

  return { onAction };
});
