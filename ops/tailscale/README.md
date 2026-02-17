# Tailscale Setup — Ubuntu 24.04 LTS (noble)

> Access `deploy@192.168.0.16` from anywhere without public IP or port-forwarding.

---

## Prerequisites

| Requirement | Details |
|---|---|
| Server | Ubuntu 24.04 LTS (noble) |
| SSH access | `ssh -i ~/.ssh/id_ed25519 deploy@192.168.0.16` |
| Privileges | `deploy` user must have **sudo** |
| Network | Server needs outbound HTTPS (443) to `login.tailscale.com` and DERP relays |
| Tailscale account | Free at <https://login.tailscale.com> |

---

## Step 1 — Install Tailscale on server

SSH into the server:

```bash
ssh -i ~/.ssh/id_ed25519 deploy@192.168.0.16
```

Install prerequisites + add official Tailscale apt repo:

```bash
# Update package index
sudo apt update

# Install prerequisites
sudo apt install -y curl ca-certificates gnupg

# Add Tailscale GPG key
curl -fsSL https://pkgs.tailscale.com/stable/ubuntu/noble.noarmor.gpg \
  | sudo tee /usr/share/keyrings/tailscale-archive-keyring.gpg >/dev/null

# Add Tailscale apt repo
curl -fsSL https://pkgs.tailscale.com/stable/ubuntu/noble.tailscale-keyring.list \
  | sudo tee /etc/apt/sources.list.d/tailscale.list

# Install Tailscale
sudo apt update
sudo apt install -y tailscale
```

---

## Step 2 — Enable and start tailscaled

```bash
sudo systemctl enable --now tailscaled
```

Verify the daemon is running:

```bash
systemctl status tailscaled --no-pager
tailscale version
```

You should see `active (running)` and the installed version.

---

## Step 3 — Bring up Tailscale (requires browser auth)

```bash
sudo tailscale up --ssh
```

This prints a login URL like:

```
To authenticate, visit:
  https://login.tailscale.com/a/xxxxxxxxxxxx
```

1. **Open that URL** in your browser.
2. **Log in** to your Tailscale account.
3. **Approve** the new node.

> `--ssh` enables Tailscale SSH so you can connect without configuring OpenSSH keys on the Tailscale network.

---

## Step 4 — Verify and find Tailscale IP

On the server:

```bash
tailscale status
tailscale ip -4
```

Note the **100.x.y.z** IP address — this is your Tailscale IP.

---

## Step 5 — Connect from your Mac

Make sure Tailscale is installed and running on your Mac (download from <https://tailscale.com/download/mac>).

```bash
ssh deploy@<TAILSCALE_IP>
```

Replace `<TAILSCALE_IP>` with the **100.x.y.z** address from step 4.

If `--ssh` was used during `tailscale up`, Tailscale SSH handles authentication — no password prompt needed.

---

## Useful Commands

| Command | Description |
|---|---|
| `tailscale status` | Show connected nodes |
| `tailscale ip -4` | Show this node's Tailscale IPv4 |
| `tailscale ping <peer>` | Test connectivity to a peer |
| `tailscale netcheck` | Diagnose network/DERP connectivity |
| `sudo tailscale down` | Disconnect from tailnet (keeps installed) |
| `sudo tailscale up --ssh` | Reconnect to tailnet with SSH enabled |

---

## Rollback / Uninstall

### Disconnect only (keep installed)

```bash
sudo tailscale down
```

### Full uninstall

```bash
# Disconnect
sudo tailscale down

# Stop and disable daemon
sudo systemctl stop tailscaled
sudo systemctl disable tailscaled

# Remove package
sudo apt purge -y tailscale

# Remove repo and key
sudo rm -f /etc/apt/sources.list.d/tailscale.list
sudo rm -f /usr/share/keyrings/tailscale-archive-keyring.gpg

# Clean up state
sudo rm -rf /var/lib/tailscale

sudo apt autoremove -y
```

After uninstall, go to <https://login.tailscale.com/admin/machines> and **remove the node** from your tailnet.

---

## Security Notes

- This setup does **NOT** modify `sshd_config` or firewall rules.
- OpenSSH on port 22 remains unchanged.
- To harden (disable password auth, restrict to Tailscale only), request a separate "HARDEN" step.
