// The default wording of every message (phase-5a-plan §3.7, PR 5), for the
// owner to approve. A store's own templates override these per event,
// channel and locale. SMS stays short: Bangla is Unicode, 70 characters a
// part, and every part costs the store. Email bodies are paragraphs
// separated by blank lines; the layout adds the store's name and a footer.
import type { Locale } from '../money';
import type { Channel, MessageEvent, ShopperEvent, StaffEvent } from './index';

export interface Template {
  /** Email subjects and push titles. */
  subject?: string;
  body: string;
}

type ByLocale = Record<Locale, Template>;

const SHOPPER_EMAIL: Record<ShopperEvent, ByLocale> = {
  order_placed: {
    en: {
      subject: 'Order {order_number} received',
      body: 'Thank you, {customer_name}. We have received your order {order_number}.\n\nTotal: {total}. To pay on delivery: {amount_due}.\n\nWe will let you know when it is confirmed and on its way. You can follow it at {order_url} with your order number and phone.',
    },
    bn: {
      subject: 'অর্ডার {order_number} পেয়েছি',
      body: 'ধন্যবাদ, {customer_name}। আপনার অর্ডার {order_number} আমরা পেয়েছি।\n\nমোট: {total}। ডেলিভারিতে দিতে হবে: {amount_due}।\n\nঅর্ডার নিশ্চিত হলে ও পাঠানো হলে জানাব। অর্ডার নম্বর ও ফোন দিয়ে {order_url} থেকে খোঁজ নিতে পারবেন।',
    },
  },
  order_confirmed: {
    en: {
      subject: 'Order {order_number} confirmed',
      body: 'Your order {order_number} is confirmed, {customer_name}. We are preparing it now.\n\nTo pay on delivery: {amount_due}.',
    },
    bn: {
      subject: 'অর্ডার {order_number} নিশ্চিত হয়েছে',
      body: '{customer_name}, আপনার অর্ডার {order_number} নিশ্চিত হয়েছে। আমরা এখন এটি প্রস্তুত করছি।\n\nডেলিভারিতে দিতে হবে: {amount_due}।',
    },
  },
  order_shipped: {
    en: {
      subject: 'Order {order_number} is on its way',
      body: 'Your order {order_number} is on its way with {carrier}. Tracking number: {tracking_number}.\n\nTo pay on delivery: {amount_due}.\n\n{tracking_url}',
    },
    bn: {
      subject: 'অর্ডার {order_number} পাঠানো হয়েছে',
      body: 'আপনার অর্ডার {order_number} {carrier} দিয়ে পাঠানো হয়েছে। ট্র্যাকিং নম্বর: {tracking_number}।\n\nডেলিভারিতে দিতে হবে: {amount_due}।\n\n{tracking_url}',
    },
  },
  order_delivered: {
    en: {
      subject: 'Order {order_number} delivered',
      body: 'Your order {order_number} has been delivered. Thank you for shopping with {store_name}.',
    },
    bn: {
      subject: 'অর্ডার {order_number} পৌঁছে গেছে',
      body: 'আপনার অর্ডার {order_number} পৌঁছে গেছে। {store_name} থেকে কেনাকাটার জন্য ধন্যবাদ।',
    },
  },
  order_cancelled: {
    en: {
      subject: 'Order {order_number} cancelled',
      body: 'Your order {order_number} has been cancelled. If you did not expect this, please reply to this email.',
    },
    bn: {
      subject: 'অর্ডার {order_number} বাতিল হয়েছে',
      body: 'আপনার অর্ডার {order_number} বাতিল করা হয়েছে। এমনটা না চাইলে এই ইমেইলের উত্তর দিন।',
    },
  },
  payment_received: {
    en: {
      subject: 'Payment received for order {order_number}',
      body: 'We have received {amount} for your order {order_number}. Still to pay: {amount_due}.',
    },
    bn: {
      subject: 'অর্ডার {order_number}-এর পেমেন্ট পেয়েছি',
      body: 'আপনার অর্ডার {order_number}-এর জন্য {amount} পেয়েছি। বাকি আছে: {amount_due}।',
    },
  },
  payment_expired: {
    en: {
      subject: 'Order {order_number} cancelled: payment not received',
      body: 'We did not receive the online payment for your order {order_number}, so it has been cancelled. You are welcome to order again at {order_url}.',
    },
    bn: {
      subject: 'অর্ডার {order_number} বাতিল: পেমেন্ট আসেনি',
      body: 'আপনার অর্ডার {order_number}-এর অনলাইন পেমেন্ট আসেনি, তাই অর্ডারটি বাতিল হয়েছে। চাইলে আবার অর্ডার করতে পারেন: {order_url}',
    },
  },
  return_approved: {
    en: {
      subject: 'Return {return_number} approved',
      body: 'Your return {return_number} for order {order_number} is approved. We will tell you how to send the items back.',
    },
    bn: {
      subject: 'ফেরত {return_number} অনুমোদিত',
      body: 'অর্ডার {order_number}-এর ফেরত {return_number} অনুমোদিত হয়েছে। পণ্য কীভাবে পাঠাবেন তা আমরা জানাব।',
    },
  },
  return_rejected: {
    en: {
      subject: 'Return {return_number} not accepted',
      body: 'We could not accept your return {return_number} for order {order_number}. Please reply to this email if you have questions.',
    },
    bn: {
      subject: 'ফেরত {return_number} গ্রহণ করা যায়নি',
      body: 'অর্ডার {order_number}-এর ফেরত {return_number} আমরা গ্রহণ করতে পারিনি। কোনো প্রশ্ন থাকলে এই ইমেইলের উত্তর দিন।',
    },
  },
  return_received: {
    en: {
      subject: 'Return {return_number} received',
      body: 'We have received the items of your return {return_number}. We will check them and let you know.',
    },
    bn: {
      subject: 'ফেরত {return_number} পেয়েছি',
      body: 'আপনার ফেরত {return_number}-এর পণ্য আমরা পেয়েছি। যাচাই করে জানাব।',
    },
  },
  refund_issued: {
    en: {
      subject: 'Refund for order {order_number}',
      body: 'We have refunded {refund_amount} for your order {order_number} by {refund_method}.',
    },
    bn: {
      subject: 'অর্ডার {order_number}-এর টাকা ফেরত',
      body: 'আপনার অর্ডার {order_number}-এর {refund_amount} {refund_method}-এ ফেরত দেওয়া হয়েছে।',
    },
  },
  store_credit_issued: {
    en: {
      subject: 'Your store credit from {store_name}',
      body: 'You have {credit_amount} to spend at {store_name}. Use the code {credit_code} at checkout. It works once, for the phone number on your order.',
    },
    bn: {
      subject: '{store_name}-এ আপনার ক্রেডিট',
      body: '{store_name}-এ আপনার {credit_amount} ক্রেডিট আছে। চেকআউটে কোড {credit_code} দিন। কোডটি একবার, আপনার অর্ডারের ফোন নম্বরে চলবে।',
    },
  },
};

const SHOPPER_SMS: Record<ShopperEvent, Record<Locale, string>> = {
  order_placed: {
    en: '{store_name}: order {order_number} received. Total {total}. Track: {order_url}',
    bn: '{store_name}: অর্ডার {order_number} পেয়েছি। মোট {total}। ট্র্যাক: {order_url}',
  },
  order_confirmed: {
    en: '{store_name}: order {order_number} confirmed.',
    bn: '{store_name}: অর্ডার {order_number} নিশ্চিত।',
  },
  order_shipped: {
    en: '{store_name}: order {order_number} sent with {carrier} {tracking_number}. Pay {amount_due} on delivery.',
    bn: '{store_name}: অর্ডার {order_number} {carrier} দিয়ে পাঠানো হয়েছে {tracking_number}। ডেলিভারিতে {amount_due}',
  },
  order_delivered: {
    en: '{store_name}: order {order_number} delivered. Thank you!',
    bn: '{store_name}: অর্ডার {order_number} পৌঁছে গেছে। ধন্যবাদ!',
  },
  order_cancelled: {
    en: '{store_name}: order {order_number} cancelled.',
    bn: '{store_name}: অর্ডার {order_number} বাতিল হয়েছে।',
  },
  payment_received: {
    en: '{store_name}: received {amount} for order {order_number}.',
    bn: '{store_name}: অর্ডার {order_number}-এর {amount} পেয়েছি।',
  },
  payment_expired: {
    en: '{store_name}: payment not received, order {order_number} cancelled.',
    bn: '{store_name}: পেমেন্ট আসেনি, অর্ডার {order_number} বাতিল।',
  },
  return_approved: {
    en: '{store_name}: return {return_number} approved.',
    bn: '{store_name}: ফেরত {return_number} অনুমোদিত।',
  },
  return_rejected: {
    en: '{store_name}: return {return_number} not accepted.',
    bn: '{store_name}: ফেরত {return_number} গ্রহণ করা যায়নি।',
  },
  return_received: {
    en: '{store_name}: return {return_number} received.',
    bn: '{store_name}: ফেরত {return_number} পেয়েছি।',
  },
  refund_issued: {
    en: '{store_name}: refunded {refund_amount} for order {order_number}.',
    bn: '{store_name}: অর্ডার {order_number}-এর {refund_amount} ফেরত দেওয়া হয়েছে।',
  },
  store_credit_issued: {
    en: '{store_name}: {credit_amount} credit. Code {credit_code}',
    bn: '{store_name}: {credit_amount} ক্রেডিট। কোড {credit_code}',
  },
};

const STAFF: Record<StaffEvent, ByLocale> = {
  new_order: {
    en: { subject: 'New order {order_number}', body: '{total} from {customer_name} ({source}).' },
    bn: { subject: 'নতুন অর্ডার {order_number}', body: '{customer_name}-এর {total} ({source})।' },
  },
  online_payment: {
    en: { subject: 'Paid online: {order_number}', body: '{amount} received for {order_number}.' },
    bn: {
      subject: 'অনলাইনে পরিশোধ: {order_number}',
      body: '{order_number}-এর জন্য {amount} এসেছে।',
    },
  },
  shopper_cancelled: {
    en: {
      subject: 'Cancelled by the shopper: {order_number}',
      body: '{customer_name} cancelled order {order_number} ({total}).',
    },
    bn: {
      subject: 'ক্রেতা বাতিল করেছেন: {order_number}',
      body: '{customer_name} অর্ডার {order_number} ({total}) বাতিল করেছেন।',
    },
  },
  return_requested: {
    en: {
      subject: 'Return requested: {return_number}',
      body: '{customer_name} asked to return items of {order_number}: {reason}.',
    },
    bn: {
      subject: 'ফেরতের অনুরোধ: {return_number}',
      body: '{customer_name} {order_number}-এর পণ্য ফেরত দিতে চান: {reason}।',
    },
  },
  payment_problem: {
    en: { subject: 'Check payment: {order_number}', body: '{problem} ({amount}).' },
    bn: { subject: 'পেমেন্ট দেখুন: {order_number}', body: '{problem} ({amount})।' },
  },
};

const isStaffEvent = (event: MessageEvent): event is StaffEvent => event in STAFF;

/** The default template, or null when the event isn't sent on that channel. */
export function defaultTemplate(
  event: MessageEvent,
  channel: Channel,
  locale: Locale,
): Template | null {
  if (isStaffEvent(event)) return channel === 'sms' ? null : STAFF[event][locale];
  if (channel === 'email') return SHOPPER_EMAIL[event][locale];
  if (channel === 'sms') return { body: SHOPPER_SMS[event][locale] };
  return null;
}
