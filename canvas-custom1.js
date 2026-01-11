"use strict";

/**
 * Canvas LMS Custom Integration
 */

// Configuration Constants
const CONFIG = {
  API_TIMEOUT: 15000, // 15 seconds
  MAX_RETRIES: 3,
  RETRY_DELAY: 1000, // 1 second
  CACHE_DURATION: 300000, // 5 minutes
  MAX_SECTIONS_PER_COURSE: 100,
  MAX_ENROLLMENTS_PER_REQUEST: 50
};

// Cache Management
const Cache = {
  store: {},
  
  set(key, value, ttl = CONFIG.CACHE_DURATION) {
    this.store[key] = {
      value,
      expiry: Date.now() + ttl
    };
  },
  
  get(key) {
    const item = this.store[key];
    if (!item) return null;
    
    if (Date.now() > item.expiry) {
      delete this.store[key];
      return null;
    }
    
    return item.value;
  },
  
  clear() {
    this.store = {};
  }
};

// Request Queue for Rate Limiting
const RequestQueue = {
  queue: [],
  processing: false,
  maxConcurrent: 3,
  activeRequests: 0,
  minDelay: 100, // 100ms between requests
  
  add(requestFn) {
    return new Promise((resolve, reject) => {
      this.queue.push({ requestFn, resolve, reject });
      this.process();
    });
  },
  
  async process() {
    if (this.processing || this.queue.length === 0) return;
    if (this.activeRequests >= this.maxConcurrent) return;
    
    this.processing = true;
    const { requestFn, resolve, reject } = this.queue.shift();
    this.activeRequests++;
    
    try {
      const result = await requestFn();
      resolve(result);
    } catch (error) {
      reject(error);
    } finally {
      this.activeRequests--;
      this.processing = false;
      
      // Delay before processing next request
      setTimeout(() => this.process(), this.minDelay);
    }
  }
};

// Logging Utility
const Logger = {
  errors: [],
  
  log(level, message, data = {}) {
    const logEntry = {
      timestamp: new Date().toISOString(),
      level,
      message,
      data,
      url: window.location.href
    };
    
    console[level === 'error' ? 'error' : 'log'](
      `[${level.toUpperCase()}] ${message}`,
      data
    );
    
    if (level === 'error') {
      this.errors.push(logEntry);
    }
  },
  
  error(message, error) {
    this.log('error', message, { 
      error: error?.message || error,
      stack: error?.stack
    });
  },
  
  info(message, data) {
    this.log('info', message, data);
  },
  
  warn(message, data) {
    this.log('warn', message, data);
  }
};

// Enhanced API Request Handler with Retry Logic
async function makeAPIRequest(url, options = {}) {
  const cacheKey = `api_${url}`;
  
  // Check cache first
  if (options.useCache !== false) {
    const cached = Cache.get(cacheKey);
    if (cached) {
      Logger.info('Cache hit', { url });
      return cached;
    }
  }
  
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), CONFIG.API_TIMEOUT);
  
  const makeRequest = async (attempt = 1) => {
    try {
      Logger.info(`API Request (attempt ${attempt})`, { url });
      
      const response = await fetch(url, {
        ...options,
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          ...options.headers
        }
      });
      
      clearTimeout(timeoutId);
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      
      const data = await response.json();
      
      // Cache successful response
      if (options.useCache !== false) {
        Cache.set(cacheKey, data);
      }
      
      return data;
      
    } catch (error) {
      clearTimeout(timeoutId);
      
      // Handle abort (timeout)
      if (error.name === 'AbortError') {
        Logger.error('Request timeout', { url, attempt });
        throw new Error(`Request timeout after ${CONFIG.API_TIMEOUT}ms`);
      }
      
      // Retry logic with exponential backoff
      if (attempt < CONFIG.MAX_RETRIES) {
        const delay = CONFIG.RETRY_DELAY * Math.pow(2, attempt - 1);
        Logger.warn(`Retrying request after ${delay}ms`, { url, attempt, error: error.message });
        
        await new Promise(resolve => setTimeout(resolve, delay));
        return makeRequest(attempt + 1);
      }
      
      Logger.error('API Request failed after retries', { url, error });
      throw error;
    }
  };
  
  return RequestQueue.add(() => makeRequest());
}

// jQuery wrapper for backward compatibility
function makeJQueryRequest(url, options = {}) {
  return new Promise((resolve, reject) => {
    $.ajax({
      url,
      method: options.method || 'GET',
      timeout: CONFIG.API_TIMEOUT,
      dataType: 'json',
      ...options
    })
    .done(resolve)
    .fail((jqXHR, textStatus, errorThrown) => {
      Logger.error('jQuery request failed', {
        url,
        status: textStatus,
        error: errorThrown
      });
      reject(new Error(`${textStatus}: ${errorThrown}`));
    });
  });
}

// Validated URL Parser
function parseCanvasUrl(href) {
  try {
    const url = new URL(href);
    const pathname = url.pathname;
    
    // Extract course ID
    const courseMatch = pathname.match(/\/courses\/(\d+)/);
    const courseId = courseMatch ? courseMatch[1] : null;
    
    // Extract lesson information
    const lessonMatch = pathname.match(/\/(pages|assignments|quizzes|discussion_topics)\/([a-zA-Z0-9_-]+)/);
    const lessonType = lessonMatch ? lessonMatch[1] : null;
    const lessonId = lessonMatch ? lessonMatch[2] : null;
    
    // Validate extracted data
    if (courseId && !/^\d+$/.test(courseId)) {
      throw new Error('Invalid course ID format');
    }
    
    return {
      courseId,
      lessonType,
      lessonId,
      isValid: !!(courseId || lessonType)
    };
    
  } catch (error) {
    Logger.error('URL parsing failed', { href, error });
    return { courseId: null, lessonType: null, lessonId: null, isValid: false };
  }
}

// User Profile with Caching
async function getUserProfile() {
  const cacheKey = 'user_profile';
  const cached = Cache.get(cacheKey);
  
  if (cached) {
    return cached;
  }
  
  try {
    const profile = await makeJQueryRequest('/api/v1/users/self/profile', { useCache: true });
    
    const userData = {
      id: profile.id,
      name: profile.name || 'Unknown User',
      email: profile.primary_email || '',
      sisId: profile.sis_user_id || null
    };
    
    Cache.set(cacheKey, userData);
    Logger.info('User profile loaded', { userId: userData.id });
    
    return userData;
    
  } catch (error) {
    Logger.error('Failed to load user profile', error);
    throw error;
  }
}

// Course Information with Validation
async function getCourseInfo(courseId) {
  if (!courseId || !/^\d+$/.test(courseId)) {
    throw new Error('Invalid course ID');
  }
  
  try {
    const course = await makeJQueryRequest(`/api/v1/courses/${courseId}`, { useCache: true });
    
    // Validate course has required fields
    if (!course.course_code) {
      Logger.warn('Course missing course_code', { courseId });
      return null;
    }
    
    // Check if this is a valid course offering
    if (!/\d+/.test(course.course_code)) {
      Logger.info('Course offering does not have term number', { courseId });
      return null;
    }
    
    if (!course.start_at || !course.end_at) {
      Logger.info('Course missing start/end dates', { courseId });
      return null;
    }
    
    return {
      id: course.id,
      code: course.course_code,
      startDate: course.start_at.split("T")[0],
      endDate: course.end_at.split("T")[0],
      term: extractTerm(course.course_code)
    };
    
  } catch (error) {
    Logger.error('Failed to load course info', { courseId, error });
    throw error;
  }
}

// Extract term from course code
function extractTerm(courseCode) {
  const match = courseCode.match(/\d+/);
  if (!match) return null;
  
  const prefix = courseCode.toLowerCase().includes("pt") 
    ? courseCode.slice(0, 4) 
    : courseCode.slice(0, 2);
    
  return `${prefix}${match[0]}`;
}

// Get Primary Section with Limits
async function getPrimarySection(courseId) {
  if (!courseId) {
    throw new Error('Course ID is required');
  }
  
  try {
    const sections = await makeJQueryRequest(
      `/api/v1/courses/${courseId}/sections?include[]=total_students&per_page=${CONFIG.MAX_SECTIONS_PER_COURSE}`,
      { useCache: true }
    );
    
    if (!Array.isArray(sections) || sections.length === 0) {
      Logger.warn('No sections found', { courseId });
      return null;
    }
    
    // Find section with most students (primary section)
    const primarySection = sections.reduce((max, section) => {
      const studentCount = section.total_students || 0;
      return studentCount > (max.total_students || 0) ? section : max;
    }, sections[0]);
    
    Logger.info('Primary section identified', { 
      courseId, 
      sectionId: primarySection.id,
      students: primarySection.total_students 
    });
    
    return primarySection;
    
  } catch (error) {
    Logger.error('Failed to get primary section', { courseId, error });
    throw error;
  }
}

// Get Page Information
async function getPageInfo(courseId, pageId) {
  if (!courseId || !pageId) {
    throw new Error('Course ID and Page ID are required');
  }
  
  try {
    const page = await makeJQueryRequest(
      `/api/v1/courses/${courseId}/pages/${pageId}`,
      { useCache: true }
    );
    
    return {
      title: page.title || 'Untitled Page',
      id: page.page_id,
      createdAt: page.created_at,
      updatedAt: page.updated_at,
      url: page.html_url,
      _url: page.url
    };
    
  } catch (error) {
    Logger.error('Failed to load page info', { courseId, pageId, error });
    throw error;
  }
}

// Get User Enrollment with Pagination
async function getUserEnrollment(courseId, userId, primarySectionId) {
  if (!courseId || !userId) {
    throw new Error('Course ID and User ID are required');
  }
  
  try {
    const enrollments = await makeJQueryRequest(
      `/api/v1/courses/${courseId}/enrollments?user_id=${userId}&per_page=${CONFIG.MAX_ENROLLMENTS_PER_REQUEST}`,
      { useCache: true }
    );
    
    if (!Array.isArray(enrollments) || enrollments.length === 0) {
      Logger.warn('No enrollments found', { courseId, userId });
      return { enrollmentId: 0 };
    }
    
    // Find enrollment that's not the primary section
    const enrollment = enrollments.find(e => e.course_id !== primarySectionId);
    
    return {
      enrollmentId: enrollment ? enrollment.id : enrollments[0].id || 0
    };
    
  } catch (error) {
    Logger.error('Failed to get user enrollment', { courseId, userId, error });
    return { enrollmentId: 0 };
  }
}

function extractTermCourseCode(course_id) {
  if (/P\d+/.test(course_id)) {
    const m = course_id.match(/^(.*?\d)(?:[A-Za-z])?(?=P\d+)/);
    return m ? m[1] : course_id;
  }

  const m2 = course_id.match(/^([A-Za-z0-9-]*\d)/);
  return m2 ? m2[1] : course_id;
}

function student_contract_uid(courseCode, studentEmail){
  const code = extractTermCourseCode(courseCode);
  return `${code}_${studentEmail}`;
}

// Populate FormStack Form with Comprehensive Error Handling
async function populateFormStackForm(fsIframe) {
  if (!fsIframe) {
    Logger.warn('FormStack iframe not found');
    return;
  }
  
  fsIframe.addEventListener("load", async function() {
    try {
      const urlData = parseCanvasUrl(window.location.href);
      
      if (!urlData.isValid || !urlData.courseId || !urlData.lessonId) {
        Logger.info('Not a valid course page for FormStack', { urlData });
        return;
      }
      
      Logger.info('Starting FormStack population', { urlData });
      
      // Fetch all required data in parallel where possible
      const [userProfile, courseInfo] = await Promise.all([
        getUserProfile(),
        getCourseInfo(urlData.courseId)
      ]);
      
      if (!courseInfo) {
        Logger.info('Course not eligible for FormStack', { courseId: urlData.courseId });
        return;
      }
      
      // Fetch dependent data
      const [primarySection, pageInfo] = await Promise.all([
        getPrimarySection(urlData.courseId),
        getPageInfo(urlData.courseId, urlData.lessonId)
      ]);
      
      const enrollment = await getUserEnrollment(
        urlData.courseId,
        userProfile.id,
        primarySec...
