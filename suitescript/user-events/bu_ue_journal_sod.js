/**
 * @NApiVersion 2.1
 * @NScriptType UserEventScript
 * @description SOX: prevent self-approval of journal entries.
 */
define(['N/runtime', 'N/error', 'N/record'], (runtime, error, record) => {

  const beforeSubmit = ({ newRecord, oldRecord, type, UserEventType }) => {
    if (type !== UserEventType.EDIT) return;

    const approving = newRecord.getValue('approved') && !oldRecord.getValue('approved');
    const creator = String(newRecord.getValue('custbody_bu_created_by'));
    const user = String(runtime.getCurrentUser().id);

    if (approving && creator === user) {
      record.create({ type: 'customrecord_bu_sox_audit' })
        .setValue({ fieldId: 'custrecord_bu_txn', value: newRecord.id })
        .setValue({ fieldId: 'custrecord_bu_user', value: user })
        .save();

      throw error.create({
        name: 'BU_SOD_VIOLATION',
        message: 'You cannot approve a journal you created.',
        notifyOff: false
      });
    }
  };

  return { beforeSubmit };
});
