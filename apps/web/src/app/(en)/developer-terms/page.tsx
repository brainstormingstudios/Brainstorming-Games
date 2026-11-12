import { createPolicyPage } from '@/lib/policies/policyPage';

const page = createPolicyPage('developer-terms');

export const generateMetadata = page.generateMetadata;
export default page.Page;
