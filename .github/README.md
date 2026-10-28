<div align="center">

# sleepwalk

**Shut your MacBook. Claude keeps working.**

[![Release](https://img.shields.io/github/v/release/adamalshoomary/sleepwalk?label=release&color=4c3f91)](https://github.com/adamalshoomary/sleepwalk/releases/latest)
[![Licence](https://img.shields.io/badge/licence-MIT-718096)](/sleepwalk/LICENSE)

<a href="https://adamalshoomary.github.io/sleepwalk/"><img src="/sleepwalk/site/install-button.svg" alt="Install sleepwalk" height="44"></a>

</div>

![A Claude chat starts a long job: clone the requests library, run its tests and fix what fails. A click on Stay awake with lid shut turns the band's moon on. The lid shuts, and the chat keeps moving on a phone through Remote Control. When the lid opens, the tests pass and the band still says Awake until 15:25.](/sleepwalk/docs/demo.gif)

<p align="center"><sub><a href="/sleepwalk/docs/demo.mp4">Watch with sound</a></sub></p>

> [!WARNING]
> While sleepwalk is on, the screen does not lock. Anyone who opens the lid finds the Mac unlocked.
> Never run a shut Mac in a bag, on a bed or under a blanket. Keep it on a hard surface.

## Install

Paste this into Claude Code:

```
Install the sleepwalk mod from https://github.com/adamalshoomary/sleepwalk.
```

<details>
<summary>Another way to install</summary>

In the desktop app: click **+** next to the prompt box, then **Plugins**, then **Add marketplace**. Type `adamalshoomary/sleepwalk`, then click **Add plugin**.

</details>

## What you see

![Two rows above the prompt. Off: a moon and a "Stay awake with lid shut" button. On: a filled moon, "Awake until 15:48, 2 h left, battery 48%", and a Stop button.](/sleepwalk/docs/band.png)

1. Click **Stay awake with lid shut** above the prompt.
2. Type your Mac password.
3. When the row says **Awake until**, shut the lid.

Click **Stop** to turn sleep back on early.

Before you shut the lid, switch the chat to Auto or Bypass permissions, or turn on Remote Control and answer from your phone. A question nobody answers stops the work.

<details>
<summary>When sleep comes back on</summary>

At the first of these:

- 2 minutes after the work ends. Background commands, agents and `/loop` wake-ups count as work.
- After 2 hours.
- On battery, at 25% charge.
- When the Mac gets hot.
- When the chat ends, or you click **Stop**.

If the lid is shut at that moment, the Mac goes to sleep at once. The row says why sleep came back on.

</details>

<details>
<summary>Commands</summary>

Type these in the chat:

- `/lid on` does the same as the button.
- `/lid on 30` sets a 30-minute limit, from 5 to 720 minutes.
- `/lid off` turns sleep back on.
- `/lid status` shows the time left and the battery.

A second chat that turns sleepwalk on joins the first, with no password.

</details>

<details>
<summary>Updates</summary>

Once a day, sleepwalk checks GitHub for a new version. When one is out, a line above the prompt shows **Update** and **Later**. Nothing installs until you click **Update**. The check sends nothing about you or your work.

</details>

<details>
<summary>Limits</summary>

- sleepwalk uses a macOS setting that Apple does not document. A macOS update could change it.
- If something kills sleepwalk's helper, sleep stays off. The next chat finds it and shows **Turn it back on**.
- An organisation's policy can block the password box.

</details>

<details>
<summary>How it works</summary>

1. The password box starts one helper that runs as the Mac's administrator. It turns sleep off with `pmset -a disablesleep 1` and keeps the display awake with `caffeinate`.
2. Every 15 seconds, each chat that uses sleepwalk tells the helper that it is still alive.
3. The helper turns sleep back on when no chat is alive, when a limit is reached, or when you click **Stop**.
4. Nothing stays installed. The helper writes one line to the system log when it starts and one when it ends.

To check the mod, run `sh tests/watcher.test.sh` and `claude plugin test .` in the `sleepwalk` folder of this repository. The watcher tests use a fake `pmset` and change nothing.

</details>

<details>
<summary>For agents</summary>

If a user asks you to install sleepwalk from this page:

1. Run `claude plugin install sleepwalk --marketplace adamalshoomary/sleepwalk`.
2. Tell the user to start a new chat in the desktop app.
3. Tell the user to click **Stay awake with lid shut** above the prompt and type their Mac password.
4. Never turn sleepwalk on for the user. The password is theirs to type.

</details>

MIT licence. See [LICENSE](/sleepwalk/LICENSE).
