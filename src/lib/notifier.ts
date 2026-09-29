import nodemailer from 'nodemailer'
import type { Transporter } from 'nodemailer'
import { env } from '../config/env.js'

export interface EmailMessage {
  to: string
  subject: string
  body: string
  html?: string
}

export interface SmsMessage {
  to: string
  body: string
}

export interface Notifier {
  sendEmail(message: EmailMessage): Promise<void>
  sendSms(message: SmsMessage): Promise<void>
}

class StubNotifier implements Notifier {
  async sendEmail(message: EmailMessage): Promise<void> {
    console.info('[notifier:email:stub]', message.to, message.subject)
    console.info('[notifier:email:stub] text body:\n', message.body)

    const resetLink = message.body.match(/https?:\/\/\S+/)?.[0]
    if (resetLink) {
      console.info('[notifier:email:stub] COPY THIS RESET LINK:\n', resetLink)
    }
  }

  async sendSms(message: SmsMessage): Promise<void> {
    console.info('[notifier:sms:stub]', message.to, message.body)
  }
}

class NodemailerNotifier implements Notifier {
  private transporter: Transporter

  constructor() {
    this.transporter = nodemailer.createTransport({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      secure: env.SMTP_PORT === 465,
      auth: {
        user: env.SMTP_USER,
        pass: env.SMTP_PASS,
      },
    })
  }

  async sendEmail(message: EmailMessage): Promise<void> {
    await this.transporter.sendMail({
      from: env.SMTP_FROM,
      to: message.to,
      subject: message.subject,
      text: message.body,
      html: message.html,
    })
  }

  async sendSms(message: SmsMessage): Promise<void> {
    console.info('[notifier:sms:stub]', message.to, message.body)
  }
}

export const notifier: Notifier = env.SMTP_PASS
  ? new NodemailerNotifier()
  : new StubNotifier()
