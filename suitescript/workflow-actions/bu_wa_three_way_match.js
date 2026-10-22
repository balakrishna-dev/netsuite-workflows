/**
 * @NApiVersion 2.1
 * @NScriptType WorkflowActionScript
 * @description PO / Item Receipt / Vendor Bill 3-way match.
 */
define(['N/query', 'N/runtime'], (query, runtime) => {

  const onAction = ({ newRecord: bill }) => {
    const script = runtime.getCurrentScript();
    const tolPct = Number(script.getParameter({ name: 'custscript_bu_tol_pct' })) || 3;
    const tolAmt = Number(script.getParameter({ name: 'custscript_bu_tol_amt' })) || 250;

    // SuiteQL: received qty & PO rate per item for the linked PO
    const rows = query.runSuiteQL({
      query: 'SELECT tl.item, SUM(tl.quantity) qty, MAX(tl.rate) rate ' +
             'FROM transactionline tl WHERE tl.createdfrom = ? GROUP BY tl.item',
      params: [bill.getValue('podocnum')]
    }).asMappedResults();

    const expected = rows.reduce((t, r) => t + r.qty * r.rate, 0);
    const billed = Number(bill.getValue('usertotal'));
    const diff = Math.abs(billed - expected);

    bill.setValue({ fieldId: 'custbody_bu_match_variance', value: diff });

    return (diff <= tolAmt || diff / expected * 100 <= tolPct) ? 'MATCHED' : 'VARIANCE';
  };

  return { onAction };
});
