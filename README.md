# Discord PurgeBot - Advanced Message Management

![Discord.js](https://img.shields.io/badge/discord.js-v14.14.1-blue)
![Node.js](https://img.shields.io/badge/node.js-%3E%3D18.0.0-green)
![License](https://img.shields.io/badge/license-MIT-orange)

A high-performance message management bot with audit logging capabilities, designed for Discord server moderation. Features bulk message deletion, permission-based access control, and real-time operation tracking.

## ✨ Key Features
- **Cross-channel message purging** Delete messages in different channels!
- **No time or amount limits** You can delete Messages which over 14 days with max 1000 messages once!
- **Permission system** Admin/Mod will be able to purge, while normal members won't be able to!
- **Log Channel with MySQL Database** Save all the purge records of a user or server!
- **Dual command support**: Slash commands & legacy prefix commands

---

## 🛠️ Command Reference

### 1. Core Commands
| Command | Parameters | Permission Required | Example | Notes |
|---------|------------|----------------------|---------|-------|
| `/purge` | `@user` | `Manage Messages` | `/purge @spammer` | Max 1000 messages/operation |
| `/logchannel set` | `#channel` | `Administrator` | `/logchannel set #audit` | Requires text channel |
| `/audit user` | `@user [limit]` | `Administrator` | `/audit user @target 15` | Default 10 records |
| `/audit guild` | `[limit]` | `Administrator` | `/audit guild 25` | Default 20 records |

### 2. Permission Matrix
| Role | Permissions | Commands Available |
|------|-------------|---------------------|
| User | - | `/help` |
| Moderator | `Manage Messages` | `/purge` |
| Admin | `Administrator` | All commands |

---

## 🚀 Installation Guide

### Prerequisites
- Node.js 18.x+
- MySQL 8.0+
- Discord Developer Portal access

### Step-by-Step Setup
1. **Install Dependencies**
   ```bash
   # Install Node.js (Ubuntu)
   curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
   sudo apt-get install -y nodejs

   # Install MySQL (Ubuntu)
   sudo apt install mysql-server
