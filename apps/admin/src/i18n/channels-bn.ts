import type { channelsEn } from './channels-en';

export const channelsBn: Record<keyof typeof channelsEn, string> = {
  'meta.intro':
    'ফেসবুক ও ইনস্টাগ্রামে আপনার পণ্য দেখান, আর বিক্রির খবর মেটাকে দিন যাতে বিজ্ঞাপন ক্রেতাদের কাছে পৌঁছায়।',
  'meta.feed': 'পণ্যের ফিড',
  'meta.feed.intro':
    'মেটা এই ঠিকানা থেকে আপনার পণ্য পড়ে নেয়, ফেসবুক ও ইনস্টাগ্রাম শপ আর ক্যাটালগ বিজ্ঞাপনের জন্য। প্রতিটি ভ্যারিয়েন্ট দাম, স্টক ও ছবিসহ থাকে।',
  'meta.feed.on': 'পণ্যের ফিড প্রকাশ করুন',
  'meta.feed.urls': 'ফিডের ঠিকানা',
  'meta.feed.urlDefault': 'আপনার স্টোরের ভাষায়',
  'meta.feed.urlBn': 'বাংলায়',
  'meta.feed.urlEn': 'ইংরেজিতে',
  'meta.feed.steps':
    'কমার্স ম্যানেজারে আপনার ক্যাটালগ খুলে Data sources → Add items → Data feed → Scheduled feed বেছে নিন। ঠিকানাটি পেস্ট করে Hourly বেছে নিন।',
  'meta.feed.copy': 'কপি',
  'meta.feed.copied': 'কপি হয়েছে',
  'meta.feed.builtAt': 'সর্বশেষ তৈরি {date}: {count}টি আইটেম।',
  'meta.feed.notBuilt': 'ফিড তৈরি হচ্ছে। এক মিনিট পরে আবার দেখুন।',
  'meta.feed.pending': '{date} থেকে যা বদলেছে, তা পরের বার তৈরিতে থাকবে, ১৫ মিনিটের মধ্যে।',
  'meta.feed.skipped.no_image': '{count}টি ভ্যারিয়েন্ট বাদ পড়েছে: ছবি নেই।',
  'meta.feed.skipped.no_price': '{count}টি ভ্যারিয়েন্ট বাদ পড়েছে: দাম নেই।',
  'meta.feed.error': 'শেষবার তৈরি করা যায়নি: {error}',
  'meta.feed.rebuild': 'এখনই আবার তৈরি করুন',
  'meta.feed.rebuilding': 'এক মিনিটের মধ্যে ফিড আবার তৈরি হবে।',
  'meta.feed.rotate': 'ঠিকানা বদলান',
  'meta.feed.rotateConfirm': 'এখনকার ঠিকানা আর কাজ করবে না। নতুন ঠিকানাটি কমার্স ম্যানেজারে পেস্ট করতে হবে।',
  'meta.feed.rotated': 'ঠিকানা বদলেছে। নতুনটি কমার্স ম্যানেজারে পেস্ট করুন।',
  'meta.events': 'মেটাকে জানানো বিক্রি',
  'meta.purchaseAt': 'কেনাকাটা জানান',
  'meta.purchaseAt.placed': 'অর্ডার দেওয়ার সময়, পিক্সেল যেমন করে',
  'meta.purchaseAt.confirmed': 'অর্ডার কনফার্ম হলে, যাতে বিজ্ঞাপন ভুয়া নয়, আসল অর্ডার থেকে শেখে',
  'meta.deliveredEvent': 'ডেলিভারির খবরও জানান',
  'meta.deliveredEvent.hint':
    'ডেলিভারি হওয়া দামসহ একটি “Delivered” ইভেন্ট, পরিশোধ হওয়া বিক্রি লক্ষ্য করা বিজ্ঞাপনের জন্য।',
  'meta.save': 'সেভ করুন',
  'meta.saved': 'সেভ হয়েছে।',
};
