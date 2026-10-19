// Sailsconf local integration contract 266ff11; synthetic tests only.
// Prepared for the existing Bridge upload field's action-modal integration.
// Wire into config/slipway.js proposal.actions only after that contract is ready.
const upload = (accept, maxBytes) => ({
  kind: 'file',
  storage: 'bridge',
  scope: 'bucket',
  directory: 'talk-material-uploads/{id}',
  filename: '{title|slug}',
  store: 'url',
  accept,
  maxBytes
})
module.exports = {
  scope: 'record',
  label: 'Upload materials',
  visibleWhen: { 'record.status': { in: ['accepted', 'confirmed'] } },
  description:
    'Add a new version for this speaker. Materials are submitted for review.',
  helper: {
    identity: 'bridge.uploadMaterials',
    inputs: 'values',
    context: ['recordId', 'actor']
  },
  fields: {
    materialType: {
      type: 'select',
      label: 'Material type',
      required: true,
      default: 'recording',
      options: ['recording', 'slides']
    },
    recording: {
      type: 'upload',
      label: 'Recorded talk',
      required: true,
      visibleWhen: { 'form.materialType': 'recording' },
      upload: upload(['video/mp4', 'video/webm'], 512 * 1024 * 1024)
    },
    slides: {
      type: 'upload',
      label: 'Slides',
      required: true,
      visibleWhen: { 'form.materialType': 'slides' },
      upload: upload(
        [
          'application/pdf',
          'application/vnd.openxmlformats-officedocument.presentationml.presentation'
        ],
        50 * 1024 * 1024
      )
    }
  }
}
