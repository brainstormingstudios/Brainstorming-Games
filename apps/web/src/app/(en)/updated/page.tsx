import { createListingPage } from '@/lib/catalogue/listingPage';

const page = createListingPage('updated');

export const generateMetadata = page.generateMetadata;
export default page.Page;
