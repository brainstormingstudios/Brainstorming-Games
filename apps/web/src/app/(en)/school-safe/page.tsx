import { createPolicyPage } from '@/lib/policies/policyPage';

const page = createPolicyPage('school-safe');

export const generateMetadata = page.generateMetadata;
export default page.Page;
