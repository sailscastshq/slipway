# Slipway product video

This optional workspace preserves Pellicule 0.1.1 and its compatible Rsbuild 1/Vue plugin 1 tooling. The dashboard uses Shipwright and Rsbuild 2 independently. The repository's default `workspaces=false` install keeps video tooling out of the dashboard dependency install.

Install and run from the repository root:

```sh
npm install --workspaces=true --workspace=@slipway/videos
npm exec --workspaces=true --workspace=@slipway/videos -- pellicule ProductUnveiling.vue
```

The source stays at `assets/js/videos/ProductUnveiling.vue`. Output paths are relative to this workspace. Do not force Pellicule's optional Rsbuild 1 peer dependencies onto the dashboard's Rsbuild 2 graph.
