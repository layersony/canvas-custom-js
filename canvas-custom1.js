// Mark feedback as done
window.addEventListener("message", function(event) {
    console.log("Message received from origin:", event);
    console.log("Data received:", event.data);

    // Check for correct origin
    if (event.origin.startsWith("https://moringa.formstack.com")) {
        console.log("Formstack data submitted:", JSON.stringify(event.data));

        const checkbox = document.getElementById('mark-as-done-checkbox');
        if (checkbox) {
            // Make the checkbox visible before clicking
            checkbox.style.display = 'block'; // Or 'visibility = visible' as needed
            console.log("Checkbox found, triggering click...");
            checkbox.click();
        } else {
            console.warn("Checkbox #mark-as-done-checkbox not found on the page.");
        }
    } else {
        console.warn("Unrecognized message origin:", event.origin);
    }
});

var current_name = null;
var current_email = null;
var current_course = null;
$(
function () {
    if(window.location.href.includes("feedback") || window.location.href.includes("contract") || window.location.href.includes("consent")) {
        $('#mark-as-done-checkbox').hide();
    }
    $.get('/api/v1/users/self/profile', function(profile) {
        console.log(JSON.stringify(profile));
        current_name = profile.name;
        current_email = profile.primary_email;
    });

  //   get course id
    var url = window.location.href;
    if(url.includes('courses/')){
        var course_str = url.substr(url.indexOf('course'));
        var segments = course_str.split('/');
        console.log('course ID'+segments[1]);
        $.get('/api/v1/courses/'+segments[1], function(course) {
            console.log(JSON.stringify(course));
            current_course = course;
  
            zE('webWidget', 'updateSettings', {
                webWidget: {
                    contactForm: {
                        title: {
                            '*': course.course_code+' Support'
                        },
                        subject: true,
                        fields: [{ id:'subject', prefill: { '*': course.course_code+' Technical Support'}}]
                    }
                }
              });
        });  
    }

    waitForElm('#fs-iframe').then((elm) => {
        console.log('Element is ready');
        console.log(elm.textContent);
        populateFormStackForm(elm);
    });
   }
);

/*
----------------------------------------------
*Populate Formstack Feedback form END
---------------------------------------------
*/
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


function populateFormStackForm(fs_iframe){
    //const fs_iframe = document.getElementById("fs-iframe"); //find the iframe with Formstack
    console.log('fs-frame::'+ fs_iframe);
    if(fs_iframe==null)return;
    // Make sure the iframe is loaded
    fs_iframe.addEventListener("load", function(){
       var data = {}
        const url = window.location.href;
        console.log(`Formstack URL:: ${url}`)
        if(url.includes('courses/')){
            let course_str = url.substr(url.indexOf('course'));
            let course_segments = course_str.split('/');
            let page_str = url.substr(url.indexOf('pages'));
            let page_segments = page_str.split('/');
            // console.log('course ID'+course_segments[1]);
            // console.log('Page Title'+page_segments[1]);
            
            // Retrieve course information
            $.get('/api/v1/courses/'+course_segments[1], function(course) {
                let current_course = course.course_code;
                let course_start = course.start_at
                let course_end = course.end_at
                let courseId = course.id
                // let course_sis_id = course.sis_course_id
                console.log(`Current course Info::${current_course}`)
                if (!/\d+/.test(current_course)){
                    
                    console.log("Course Offering does not have term number included")
                    return
                }
                if(!course_start||!course_end){
                    console.log("This Course Offering is either Blueprint or does not have start or end date included")
                    return
                }
                data["course_code"] =  current_course
                data["course_start"] = course_start.split("T")[0]
                data["course_end"] = course_end.split("T")[0]
               
                  if (current_course.toLocaleLowerCase().includes("PT")){
                    data["term"] = `${current_course.slice(0, 4)}${current_course.match(/\d+/)[0]}`
                }else{
                    data["term"] = `${current_course.slice(0, 2)}${current_course.match(/\d+/)[0]}`
                }
                //*Retrieve sections
                $.get(`/api/v1/courses/${course_segments[1]}/sections?include[]=total_students`, function(sectionList) {
                    var max = 0
                    var primarySectionId = 0
                    for(var i=0; i<sectionList.length; i++){   
                        if(max <  sectionList[i].total_students){
                            max = sectionList[i].total_students
                        }
                    }
                    for(var i=0; i<sectionList.length; i++){   
                        if(max === sectionList[i].total_students){
                            primarySectionId = sectionList[i].id
                        }
                    }
                    // Get Page info for content feedback
                    $.get(`/api/v1/courses/${course_segments[1]}/pages/${page_segments[1]}`, function(page) { 
                        var page_title = page.title
                        var page_id = page.page_id
                        var page_created_at = page.created_at
                        var page_updated_at = page.updated_at
                        var page_url = page.html_url
                        var _url = page.url
                       // console.log(Page url: ${page_url})
                        data["page_title"] = page_title
                        data["page_id"] = page_id
                        data["page_created_at"] = page_created_at 
                        data["page_updated_at"] = page_updated_at
                        data["page_url"] = page_url
                        data["_url"] = _url
                        // Get enrollment ID
                        
                        // Get Profile of user
                        $.get('/api/v1/users/self/profile', function(profile) {
                            // Get the current user profile
                            
                            
                            //console.log(JSON.stringify(profile));
                           var current_user_id = profile.id;
                           var current_user_name = profile.name;
                           var current_user_email = profile.primary_email;
                           var current_sis_id = profile.sis_user_id;
                            
                            // debugg log
                            // console.log(current_user_id);
                            // console.log(current_user_email);
                            
                            // data object
                            data["id"] =  current_user_id
                            data["name"] =  current_user_name
                            data["email"] =  current_user_email
                            data["SIS_Id"] = current_sis_id

                            data["student_uid"] = student_contract_uid(current_course, current_user_email)
                            
                            console.log(student_contract_uid(current_course, current_user_email));
                            
                            // debugg log
                           // console.log(Canvas:: User ID ${current_user_id});
                            // console.log(current_user_email);
                            
                            
                            // data object
                            data["id"] =  current_user_id
                            data["name"] =  current_user_name
                            // data["email"] =  current_user_email
                            data["SIS_Id"] = current_sis_id
                            
                            
                            $.get(`/api/v1/courses/${courseId}/enrollments?user_id=${current_user_id}`, function(enrollmentsList) {
                                // Getting the section enrollment. 
                                var current_LMS_id;
                                let enrollment
                                for(var i=0; i<enrollmentsList.length; i++){   
                                    if(primarySectionId !==  enrollmentsList[i].course_id){
                                        enrollment = enrollmentsList[i]
                                    }
                                }
                                if(enrollment){
                                     current_LMS_id = enrollment.id
                                }else{
                                     current_LMS_id = 0;
                                }
                               
                               // console.log(Canvas:: LMS ID ${current_LMS_id});
                                data["LMS_Id"] = current_LMS_id
                                // console.log(data["SIS_Id"])
                                // console.log(data["course_code"])
                                fs_iframe.contentWindow.postMessage(data, "*")
                                // console.log("I. data passed")
                            }); 
                        });
                    });
                });
            });  
        }    
    })
};

function waitForElm(selector) {
    return new Promise(resolve => {
        if (document.querySelector(selector)) {
            return resolve(document.querySelector(selector));
        }
        const observer = new MutationObserver(mutations => {
            if (document.querySelector(selector)) {
                resolve(document.querySelector(selector));
                observer.disconnect();
            }
        });
        observer.observe(document.body, {
            childList: true,
            subtree: true
        });
    });
}
