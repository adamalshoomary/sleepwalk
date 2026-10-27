<div align="center">

# sleepwalk

**Shut your MacBook. Claude keeps working.**

A Claude Code mod for the desktop app on macOS. One switch keeps a session running with the lid shut, on battery or on the charger, and turns sleep back on when the work ends.

[![Release](https://img.shields.io/github/v/release/adamalshoomary/sleepwalk?label=release&color=4c3f91)](https://github.com/adamalshoomary/sleepwalk/releases/latest)
[![Licence](https://img.shields.io/badge/licence-MIT-718096)](LICENSE)

<a href="https://adamalshoomary.github.io/sleepwalk/"><img src="site/install-button.svg" alt="Install sleepwalk" height="44"></a>

</div>

> [!WARNING]
> While the mode is on, the screen does not lock. Anyone who opens the lid finds the Mac unlocked.
> Never run a shut Mac in a bag, on a bed or under a blanket. Keep it on a hard surface.

## Install

**1. Paste this into Claude Code.** This is the easiest way.

```
Install the sleepwalk mod from https://github.com/adamalshoomary/sleepwalk.
```

**2. Or type this in a terminal session.**

```
/plugin install sleepwalk --marketplace adamalshoomary/sleepwalk
```

Answer `y` to add the marketplace, then press Enter for the user scope. The mod then loads in the desktop app's sessions too.

<details>
<summary>Other ways to install</summary>

**From a shell:**

```bash
claude plugin install sleepwalk --marketplace adamalshoomary/sleepwalk
```

**In the desktop app:** click **+** next to the prompt box, then **Plugins**, then **Add marketplace**. Type `adamalshoomary/sleepwalk`, then click **Add plugin**.

</details>

## Use

1. Start the work in a session.
2. Click **Keep working with the lid closed** in the band above the prompt, or type `/lid on`.
3. Type your Mac password.
4. Wait for `sleepwalking` in the prompt footer, then shut the lid.

Other commands:

- `/lid off` ends the mode early.
- `/lid status` shows the hold, the battery and the time left.
- `/lid on 30` sets a 30-minute limit for this hold, from 5 to 720 minutes.

A second session that turns the mode on joins the running hold with no password.

**Before you shut the lid**, switch the session to Auto or Bypass permissions, or turn on Remote Control and answer prompts from your phone. A prompt nobody answers stops the work. The band warns you if the session can still ask.

## When sleep comes back on

At the first of these:

- 2 minutes after the work ends. Background commands, agents and `/loop` wake-ups count as work.
- After 2 hours.
- On battery, at 25% charge.
- When the Mac gets hot: thermal pressure Heavy, or the battery at 40 °C.
- When the session ends or crashes, or `/lid off`.

If the lid is shut at that moment, the Mac goes to sleep straight away. The band says why the hold ended. Change the time limit and battery floor in `/config` in a terminal session.

## Limits

- `pmset disablesleep` is undocumented. A macOS update could change it.
- If the watcher is killed with `kill -9`, sleep stays off. The next session start finds it and shows **Turn sleep back on**. By hand: `sudo pmset -a disablesleep 0`.
- A mod cannot add to the session's ⋯ menu, so the switch lives in the band, the footer and `/lid`.
- An organisation policy can block the password box.

<details>
<summary>How it works</summary>

The password box starts one root process, the watcher. It runs `pmset -a disablesleep 1` and holds the display awake with `caffeinate -d -i -u`. The same process turns sleep back on, so no later `sudo` is needed.

Each session in the hold writes a heartbeat to `~/Library/Caches/sleepwalk/` every 15 seconds. The watcher checks every 5 seconds and ends the hold when no live session has a heartbeat under 90 seconds old, when a limit is reached, or on `HUP`, `INT` or `TERM`.

Nothing stays installed: no launch daemon, no sudoers rule, no helper file. The watcher writes one line to the system log when it starts and one when it ends:

```bash
log show --last 1h --predicate 'process == "logger" AND eventMessage BEGINSWITH "sleepwalk:"'
```

To check the mod, run `sh tests/watcher.test.sh` (fake `pmset`, changes nothing) and `claude plugin test .` in this folder.

</details>

## For agents

If a user asks you to install sleepwalk from this page, follow these steps.

1. Run `claude plugin install sleepwalk --marketplace adamalshoomary/sleepwalk`.
2. Tell the user to start a new session in the desktop app.
3. Tell them to click **Keep working with the lid closed** in the band, or type `/lid on`, and type their Mac password.
4. Never turn the mode on for them. The password is theirs to type.

## Licence

MIT. See [LICENSE](LICENSE).
