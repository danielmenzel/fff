# FFF on Android / Termux

Run [FFF](https://github.com/dmtrKovalenko/fff) in the
[pi](https://github.com/badlogic/pi-mono) coding agent on Termux (aarch64).

## Upstream support

Upstream supports Termux since release v0.11.0. This fork no longer changes
the source. It keeps only these notes.

- `packages/fff-node/package.json` and `packages/fff-bun/package.json` list
  `android` in `"os"`.
- `packages/fff-node/src/platform.ts` maps the target triple
  `aarch64-linux-android` to `@ff-labs/fff-bin-android-arm64`.
- The release workflow builds `libfff_c.so` with the Android NDK
  (`aarch64-linux-android24-clang`).
- npm publishes the result as `@ff-labs/fff-bin-android-arm64`.

Node in Termux reports `process.platform === "android"` and
`process.arch === "arm64"`. For this reason npm selects the Android binary
package automatically.

## Install

```sh
pi install npm:@ff-labs/pi-fff
```

Quit pi and start it again. Then run this command in pi:

```
/fff-health
```

The command shows the FFF version, the indexed file count, and the state of the
frecency database.

`pi update --extensions` installs later releases.

## Do not preload the `__clear_cache` shim

FFF 0.11.0 uses `ffi-rs` 1.3.7. The Android NAPI module of that version does not
reference the `__clear_cache` symbol:

```sh
readelf --dyn-syms node_modules/@yuuang/ffi-rs-android-arm64/ffi-rs.android-arm64.node | grep clear_cache
# no output
```

Earlier `ffi-rs` versions need a shim with that symbol. If you use such a
version, add the shim to `LD_PRELOAD`, **after** the Termux exec library:

```sh
export LD_PRELOAD=$PREFIX/lib/libtermux-exec.so:$HOME/.local/lib/libclear_cache.so
```

Keep `libtermux-exec.so` first. Termux cannot run scripts with the shebang
`#!/usr/bin/env node`, because `/usr/bin/env` does not exist. `libtermux-exec.so`
repairs the shebang of each executed script. A value of `LD_PRELOAD` that does
not include it makes `tsc`, `tsup`, and other npm commands fail with:

```
bad interpreter: No such file or directory
```

This is also true for each bash command that pi runs. Set `LD_PRELOAD` in your
shell, not in a wrapper for `pi`.

## Run a local checkout

Use these steps to test a change in this repository.

```sh
cd ~/repos/fff

# 1. Install the npm workspaces.
cd packages
npm install

# 2. Build the Node bindings.
npm run build -w fff-node

# 3. Put a native library in place. Use the released binary:
mkdir -p fff-node/bin
npm pack @ff-labs/fff-bin-android-arm64@0.11.0
tar xzf ff-labs-fff-bin-android-arm64-0.11.0.tgz -C fff-node/bin --strip-components=1
```

You can build the library from source instead:

```sh
cd ~/repos/fff
cargo build --release -p fff-c
```

The dev workspace looks for `target/release/libfff_c.so` before the npm package,
so no copy is necessary. A source build needs `pkg install rust cmake binutils`.
`cmake` builds the vendored libgit2.

Add the extension to `~/.pi/agent/settings.json`:

```json
"extensions": [
  "/data/data/com.termux/files/home/repos/fff/packages/pi-fff/src/index.ts"
]
```

Do not install the npm package and register this path at the same time. pi then
loads the extension twice.

## Tested with

| Component | Version |
| --- | --- |
| FFF | 0.11.0 |
| `ffi-rs` | 1.3.7 |
| Node.js | v26.13.0 (Termux) |
| Device | aarch64 Android |
