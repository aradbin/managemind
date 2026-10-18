// Bangla for messages-en.ts.
import type { messagesEn } from './messages-en';

export const messagesBn: Record<keyof typeof messagesEn, string> = {
  'alerts.title': 'নোটিফিকেশন',
  'alerts.intro': 'এই দোকান থেকে কোন খবর কীভাবে পাবেন, বেছে নিন।',
  'alerts.device': 'এই ডিভাইসে নোটিফিকেশন',
  'alerts.device.on': 'এই ডিভাইসে নোটিফিকেশন চালু করুন',
  'alerts.device.test': 'পরীক্ষামূলক নোটিফিকেশন পাঠান',
  'alerts.device.tested': '{count}টি ডিভাইসে পাঠানো হয়েছে।',
  'alerts.device.remove': 'সরান',
  'alerts.device.unknown': 'অজানা ডিভাইস',
  'alerts.device.none': 'এখনো কোনো ডিভাইসে নোটিফিকেশন আসে না।',
  'alerts.device.this': 'এই ডিভাইস',
  'alerts.device.unsupported': 'এই ব্রাউজারে নোটিফিকেশন আসে না।',
  'alerts.device.ios':
    'আইফোন বা আইপ্যাডে আগে অ্যাপটি হোম স্ক্রিনে যোগ করুন (শেয়ার → Add to Home Screen), তারপর সেখান থেকে খুলুন।',
  'alerts.device.denied': 'এই সাইটের নোটিফিকেশন বন্ধ করা আছে। ব্রাউজারের সেটিংসে চালু করে আবার চেষ্টা করুন।',
  'alerts.device.off': 'প্ল্যাটফর্মে পুশ নোটিফিকেশন এখনো চালু হয়নি। ইমেইলে খবর পাবেন।',
  'alerts.choices': 'কোন খবর পাবেন',
  'alerts.channel.push': 'পুশ',
  'alerts.channel.email': 'ইমেইল',
  'alerts.saved': 'সংরক্ষিত হয়েছে।',
  'alerts.event.new_order': 'নতুন অর্ডার',
  'alerts.event.online_payment': 'অনলাইন পেমেন্ট এসেছে',
  'alerts.event.shopper_cancelled': 'ক্রেতা অর্ডার বাতিল করেছেন',
  'alerts.event.return_requested': 'ফেরতের অনুরোধ',
  'alerts.event.payment_problem': 'একটি পেমেন্ট দেখা দরকার',
};
