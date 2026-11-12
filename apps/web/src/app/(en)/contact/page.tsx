import { createPolicyPage } from '@/lib/policies/policyPage';

const page = createPolicyPage('contact');

export const generateMetadata = page.generateMetadata;
export default page.Page;
