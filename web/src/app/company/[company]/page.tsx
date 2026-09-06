// THE COMPANY ROOM's canonical door (Galen, Sep 5: "the .company first isn't
// working with auth vars — ok we can do cartridge.cafe/company"): Google OAuth
// cannot register wildcard-subdomain callbacks, so sign-in on
// <handle>.cartridge.cafe always breaks. The PATH is the door; the subdomain
// 307s here (proxy.ts) so shared links still land.
export { default, } from '@/app/c/[company]/page'
