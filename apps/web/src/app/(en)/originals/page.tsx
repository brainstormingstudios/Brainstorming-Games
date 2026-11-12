import { createListingPage } from '@/lib/catalogue/listingPage';

const page = createListingPage('originals');

export const generateMetadata = page.generateMetadata;
export default page.Page;
